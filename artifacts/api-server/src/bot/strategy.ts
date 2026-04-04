/**
 * strategy.ts — 政策決定チーム（自律改善エンジン）
 *
 * 「なぜこのプロセスが最適なのか？」を常に疑い、
 * データに基づいた仮説を立て、自動的にパラメータを調整する。
 *
 * 管理対象パラメータ:
 *   - 外部情報収集の間隔（monitorIntervalHours）
 *   - コンテンツ種別ごとの投稿重み（typeWeights）
 *   - 各スロットの評価スコア
 */

import { readJson, writeJson } from './cloudStore.js';
import { getAllPosts, getExternalPatternsInfo } from './storage.js';

// ─── 型定義 ──────────────────────────────────────────────────────────────────

export interface Hypothesis {
  id: string;
  question: string;                         // 「○○は最適か？」
  status: 'pending' | 'confirmed' | 'rejected' | 'adjusted';
  finding: string;                          // 検証結果の説明
  adjustment: string | null;               // 行った調整
  testedAt: string;
}

export interface DecisionLog {
  at: string;
  cycle: number;
  decisions: string[];
}

export interface StrategyConfig {
  monitorIntervalHours: number;            // 外部監視間隔（デフォルト 3h）
  typeWeights: Record<string, number>;     // コンテンツ種別の投稿重み
  cycleStats: {                            // 監視サイクルの効率記録
    lastNewPatterns: number;
    avgNewPatterns: number;
    totalCycles: number;
  };
  hypotheses: Hypothesis[];
  decisionLog: DecisionLog[];
  lastEvaluatedAt: string | null;
  version: number;
}

const DEFAULT_CONFIG: StrategyConfig = {
  monitorIntervalHours: 3,
  typeWeights: {
    amateur: 1.0,
    buzz:    1.0,
    rank:    1.0,
    sale:    0.8,
    random:  0.8,
  },
  cycleStats: { lastNewPatterns: 0, avgNewPatterns: 0, totalCycles: 0 },
  hypotheses: [],
  decisionLog: [],
  lastEvaluatedAt: null,
  version: 1,
};

// ─── インメモリキャッシュ ─────────────────────────────────────────────────────

let config: StrategyConfig = { ...DEFAULT_CONFIG };

export async function loadStrategyConfig(): Promise<void> {
  config = await readJson<StrategyConfig>('strategy-config.json', DEFAULT_CONFIG);
  console.log(
    `  🧠 戦略設定読み込み: 監視間隔 ${config.monitorIntervalHours}h / 仮説 ${config.hypotheses.length}件 / サイクル ${config.cycleStats.totalCycles}回`,
  );
}

async function saveConfig(): Promise<void> {
  await writeJson('strategy-config.json', config);
}

export function getMonitorIntervalMs(): number {
  return config.monitorIntervalHours * 60 * 60 * 1000;
}

export function getTypeWeights(): Record<string, number> {
  return config.typeWeights;
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────

function score(m: { like_count?: number; retweet_count?: number; bookmark_count?: number; reply_count?: number }): number {
  return (m.like_count ?? 0) + (m.retweet_count ?? 0) * 3 + (m.bookmark_count ?? 0) * 2 + (m.reply_count ?? 0);
}

function addHypothesis(h: Hypothesis) {
  // 同じIDで上書き
  const idx = config.hypotheses.findIndex((x) => x.id === h.id);
  if (idx >= 0) {
    config.hypotheses[idx] = h;
  } else {
    config.hypotheses.push(h);
  }
}

function log(cycle: number, decisions: string[]) {
  config.decisionLog.unshift({
    at: new Date().toISOString(),
    cycle,
    decisions,
  });
  // 最新50件のみ保持
  config.decisionLog = config.decisionLog.slice(0, 50);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ─── 仮説①：監視間隔は最適か？ ──────────────────────────────────────────────

function evaluateMonitorInterval(newPatternsThisCycle: number): string | null {
  const s = config.cycleStats;
  s.totalCycles++;
  s.lastNewPatterns = newPatternsThisCycle;
  s.avgNewPatterns = s.totalCycles === 1
    ? newPatternsThisCycle
    : s.avgNewPatterns * 0.7 + newPatternsThisCycle * 0.3; // 指数移動平均

  const avg = s.avgNewPatterns;
  const current = config.monitorIntervalHours;
  let adjustment: string | null = null;

  if (s.totalCycles < 3) {
    // データ不足のため評価スキップ
    addHypothesis({
      id: 'monitor-interval',
      question: '外部情報の収集間隔（現在 ' + current + 'h）は最適か？',
      status: 'pending',
      finding: `データ蓄積中 (${s.totalCycles}サイクル, 直近 ${newPatternsThisCycle}件新規)`,
      adjustment: null,
      testedAt: new Date().toISOString(),
    });
    return null;
  }

  let newInterval = current;

  if (avg < 2 && current < 6) {
    // 収集効率が低い（平均2件未満）→ 間隔を延ばして無駄なAPIコールを削減
    newInterval = clamp(current + 1, 1, 6);
    adjustment = `監視間隔を ${current}h → ${newInterval}h に延長（平均新規パターン ${avg.toFixed(1)}件/サイクル）`;
  } else if (avg >= 15 && current > 1) {
    // 収集効率が高い（平均15件以上）→ 間隔を縮めてより多くのデータを収集
    newInterval = clamp(current - 1, 1, 6);
    adjustment = `監視間隔を ${current}h → ${newInterval}h に短縮（平均新規パターン ${avg.toFixed(1)}件/サイクル）`;
  } else {
    adjustment = null;
  }

  addHypothesis({
    id: 'monitor-interval',
    question: '外部情報の収集間隔（現在 ' + current + 'h）は最適か？',
    status: adjustment ? 'adjusted' : 'confirmed',
    finding: `${s.totalCycles}サイクル実績 / 平均新規パターン ${avg.toFixed(1)}件/サイクル`,
    adjustment,
    testedAt: new Date().toISOString(),
  });

  if (newInterval !== current) {
    config.monitorIntervalHours = newInterval;
    return adjustment;
  }
  return null;
}

// ─── 仮説②：コンテンツ種別の投稿重みは最適か？ ──────────────────────────────

function evaluateTypeWeights(): string | null {
  const posts = getAllPosts().filter((p) => p.metrics && p.type);
  if (posts.length < 10) {
    addHypothesis({
      id: 'type-weights',
      question: 'どのコンテンツ種別が最もエンゲージメントを稼ぐか？',
      status: 'pending',
      finding: `投稿データ不足 (${posts.length}件)。10件以上で評価開始。`,
      adjustment: null,
      testedAt: new Date().toISOString(),
    });
    return null;
  }

  // 種別ごとの平均スコアを集計
  const byType: Record<string, { total: number; count: number }> = {};
  for (const p of posts) {
    if (!p.metrics) continue;
    const t = p.type;
    if (!byType[t]) byType[t] = { total: 0, count: 0 };
    byType[t].total += score(p.metrics);
    byType[t].count++;
  }

  const avgByType: Record<string, number> = {};
  for (const [t, s] of Object.entries(byType)) {
    avgByType[t] = s.total / s.count;
  }

  // 全体平均
  const allScores = Object.values(avgByType);
  const globalAvg = allScores.reduce((a, b) => a + b, 0) / allScores.length;

  if (globalAvg === 0) return null;

  const adjustments: string[] = [];
  const newWeights = { ...config.typeWeights };

  for (const [t, avg] of Object.entries(avgByType)) {
    const ratio = avg / globalAvg;
    // 重みを現在値から徐々に調整（急激な変化を避けるため 20% ずつ近づける）
    const current = newWeights[t] ?? 1.0;
    const target = clamp(ratio, 0.3, 2.0);
    const updated = current * 0.8 + target * 0.2;
    newWeights[t] = Math.round(updated * 100) / 100;

    if (Math.abs(updated - current) > 0.05) {
      adjustments.push(`${t}: ${current.toFixed(2)} → ${newWeights[t].toFixed(2)} (平均スコア ${avg.toFixed(1)})`);
    }
  }

  const summary = Object.entries(avgByType)
    .sort(([, a], [, b]) => b - a)
    .map(([t, s]) => `${t}(${s.toFixed(1)})`)
    .join(' > ');

  addHypothesis({
    id: 'type-weights',
    question: 'どのコンテンツ種別が最もエンゲージメントを稼ぐか？',
    status: adjustments.length > 0 ? 'adjusted' : 'confirmed',
    finding: `エンゲージメント順: ${summary}`,
    adjustment: adjustments.length > 0 ? adjustments.join(', ') : null,
    testedAt: new Date().toISOString(),
  });

  if (adjustments.length > 0) {
    config.typeWeights = newWeights;
    return `コンテンツ重み更新: ${adjustments.join(' / ')}`;
  }
  return null;
}

// ─── 仮説③：動的テンプレートは効果があるか？ ─────────────────────────────────

function evaluateDynamicTemplates(): string | null {
  const posts = getAllPosts().filter((p) => p.metrics);
  if (posts.length < 8) {
    addHypothesis({
      id: 'dynamic-templates',
      question: '動的テンプレート（外部データ由来）は静的テンプレートより効果があるか？',
      status: 'pending',
      finding: 'データ不足で評価不可',
      adjustment: null,
      testedAt: new Date().toISOString(),
    });
    return null;
  }

  // テキストパターンで簡易判定（動的テンプレートはプレースホルダー展開後のため完全判定不可）
  // ここでは時系列で改善傾向を見る（後半が前半より良いか）
  const sorted = [...posts].sort((a, b) => new Date(a.postedAt).getTime() - new Date(b.postedAt).getTime());
  const half = Math.floor(sorted.length / 2);
  const older = sorted.slice(0, half);
  const newer = sorted.slice(half);

  const avgOlder = older.reduce((s, p) => s + score(p.metrics!), 0) / older.length;
  const avgNewer = newer.reduce((s, p) => s + score(p.metrics!), 0) / newer.length;
  const improvement = avgOlder > 0 ? ((avgNewer - avgOlder) / avgOlder) * 100 : 0;

  addHypothesis({
    id: 'dynamic-templates',
    question: '動的テンプレート（外部データ由来）は静的テンプレートより効果があるか？',
    status: improvement > 5 ? 'confirmed' : improvement < -10 ? 'rejected' : 'pending',
    finding: `直近 ${newer.length}件の平均スコア ${avgNewer.toFixed(1)} vs 以前 ${avgOlder.toFixed(1)} (${improvement >= 0 ? '+' : ''}${improvement.toFixed(1)}%)`,
    adjustment: null,
    testedAt: new Date().toISOString(),
  });

  return null;
}

// ─── 仮説④：投稿時間に取りこぼしや非効率なスロットはないか？ ──────────────────

function evaluatePostingHours(): string | null {
  const posts = getAllPosts().filter((p) => p.metrics);
  if (posts.length < 6) {
    addHypothesis({
      id: 'posting-hours',
      question: '現在の投稿スロット（09/12/18/21/23時）は最適か？',
      status: 'pending',
      finding: 'データ不足で評価不可',
      adjustment: null,
      testedAt: new Date().toISOString(),
    });
    return null;
  }

  const hourStats: Record<number, { total: number; count: number }> = {};
  for (const p of posts) {
    const h = (new Date(p.postedAt).getUTCHours() + 9) % 24;
    if (!hourStats[h]) hourStats[h] = { total: 0, count: 0 };
    hourStats[h].total += score(p.metrics!);
    hourStats[h].count++;
  }

  const ranking = Object.entries(hourStats)
    .map(([h, s]) => ({ hour: Number(h), avg: s.total / s.count, count: s.count }))
    .filter((x) => x.count >= 2)
    .sort((a, b) => b.avg - a.avg);

  const best = ranking[0];
  const worst = ranking[ranking.length - 1];

  const finding = ranking.length > 0
    ? `最高スロット: ${best.hour}時 (avg ${best.avg.toFixed(1)}) / 最低スロット: ${worst.hour}時 (avg ${worst.avg.toFixed(1)})`
    : 'データ不足';

  addHypothesis({
    id: 'posting-hours',
    question: '現在の投稿スロット（09/12/18/21/23時）は最適か？',
    status: 'confirmed',
    finding,
    adjustment: null,
    testedAt: new Date().toISOString(),
  });

  return null;
}

// ─── メイン評価関数（監視サイクル後に呼ぶ）────────────────────────────────────

export async function evaluateAndAdapt(newPatternsThisCycle: number): Promise<void> {
  const jst = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  console.log(`\n[${jst}] 🧠 戦略エンジン: 自己評価開始 (サイクル #${config.cycleStats.totalCycles + 1})`);

  const decisions: string[] = [];

  // 各仮説を並列検証
  const d1 = evaluateMonitorInterval(newPatternsThisCycle);
  const d2 = evaluateTypeWeights();
  const d3 = evaluateDynamicTemplates();
  const d4 = evaluatePostingHours();

  if (d1) { console.log(`  📐 [監視間隔] ${d1}`); decisions.push(d1); }
  if (d2) { console.log(`  ⚖️  [投稿重み] ${d2}`); decisions.push(d2); }
  if (d3) { console.log(`  🧬 [テンプレート] ${d3}`); decisions.push(d3); }
  if (d4) { console.log(`  🕐 [投稿時間] ${d4}`); decisions.push(d4); }

  if (decisions.length === 0) {
    console.log('  ✅ 現状の設定に問題なし（変更なし）');
  }

  config.lastEvaluatedAt = new Date().toISOString();
  config.version++;
  log(config.cycleStats.totalCycles, decisions.length > 0 ? decisions : ['評価完了 / 変更なし']);

  await saveConfig();

  // 仮説一覧をコンソールに出力（デバッグ用）
  console.log('  📋 仮説状態:');
  for (const h of config.hypotheses) {
    const icon = h.status === 'confirmed' ? '✅' : h.status === 'rejected' ? '❌' : h.status === 'adjusted' ? '🔧' : '⏳';
    console.log(`    ${icon} [${h.id}] ${h.finding}`);
  }
}

// ─── 重み付きランダム選択（コンテンツ種別の選択に使う）────────────────────────

export function weightedTypePick(types: string[]): string {
  const weights = config.typeWeights;
  const pool: string[] = [];
  for (const t of types) {
    const w = Math.max(1, Math.round((weights[t] ?? 1.0) * 10));
    for (let i = 0; i < w; i++) pool.push(t);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── 戦略サマリーAPI ─────────────────────────────────────────────────────────

export function getStrategySummary() {
  return {
    monitorIntervalHours: config.monitorIntervalHours,
    typeWeights: config.typeWeights,
    cycleStats: config.cycleStats,
    hypotheses: config.hypotheses,
    lastEvaluatedAt: config.lastEvaluatedAt,
    recentDecisions: config.decisionLog.slice(0, 5),
  };
}
