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

// A/Bテスト週判定（strategy内ローカル）
function isABTestWeek(): boolean {
  const nowJst = new Date(Date.now() + 9 * 3600000);
  const dateKey = nowJst.toISOString().slice(0, 10);
  return (dateKey >= '2026-04-07' && dateKey <= '2026-04-20');
}

// ─── 仮説②：コンテンツ種別の投稿重みは最適か？ ──────────────────────────────

function evaluateTypeWeights(): string | null {
  // シャドウバン回復A/Bテスト期間中は重みを自動調整しない（手動設定を維持）
  if (isABTestWeek()) {
    console.log('  ⚙️  [重み評価] A/Bテスト期間中 → 重み自動調整をスキップ（手動設定を維持）');
    return null;
  }

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

// ─── 仮説⑤：5型コンテンツ（レビュー/比較/ランキング/失敗回避/共感）どれが最もエンゲージメントを稼ぐか？ ──

function evaluateContentTypes(): string | null {
  const posts = getAllPosts().filter((p) => p.metrics && (p as any).contentType);
  if (posts.length < 5) {
    addHypothesis({
      id: 'content-5types',
      question: '5型コンテンツ（レビュー/比較/ランキング/失敗回避/共感）どれが最もエンゲージメントを稼ぐか？',
      status: 'pending',
      finding: `データ不足 (${posts.length}件)。各型に1件以上、合計5件以上で評価開始。`,
      adjustment: null,
      testedAt: new Date().toISOString(),
    });
    return null;
  }

  const byContentType: Record<string, { total: number; count: number }> = {};
  for (const p of posts) {
    const ct = (p as any).contentType as string;
    if (!ct) continue;
    if (!byContentType[ct]) byContentType[ct] = { total: 0, count: 0 };
    byContentType[ct].total += score(p.metrics!);
    byContentType[ct].count++;
  }

  const ranked = Object.entries(byContentType)
    .filter(([, v]) => v.count >= 1)
    .map(([ct, v]) => ({ ct, avg: v.total / v.count, count: v.count }))
    .sort((a, b) => b.avg - a.avg);

  if (ranked.length < 2) return null;

  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const rankSummary = ranked.map((r) => `${r.ct}(avg:${r.avg.toFixed(1)}, n=${r.count})`).join(' > ');

  const finding = `エンゲージメント順: ${rankSummary}`;
  const adjustment = `最高型: ${best.ct} / 最低型: ${worst.ct}（差: ${(best.avg - worst.avg).toFixed(1)}pt）`;

  addHypothesis({
    id: 'content-5types',
    question: '5型コンテンツ（レビュー/比較/ランキング/失敗回避/共感）どれが最もエンゲージメントを稼ぐか？',
    status: 'adjusted',
    finding,
    adjustment,
    testedAt: new Date().toISOString(),
  });

  console.log(`  🔬 [5型比較] ${finding}`);
  return null; // 重み変更は自動では行わず、知見として記録のみ
}

// ─── 仮説⑥：インプ狙い投稿はアカウントのリーチを改善しているか？ ──────────────

function evaluateImpressionEffect(): string | null {
  const allPosts = getAllPosts().filter((p) => p.metrics);
  if (allPosts.length < 10) {
    addHypothesis({
      id: 'impression-effect',
      question: 'インプ狙い投稿（10:30）の追加はアフィリ投稿のエンゲージメントを向上させているか？',
      status: 'pending',
      finding: `データ不足 (${allPosts.length}件)。10件以上で評価開始。`,
      adjustment: null,
      testedAt: new Date().toISOString(),
    });
    return null;
  }

  // インプ投稿と宣伝投稿を分離してそれぞれの平均スコアを比較
  const impressionPosts = allPosts.filter((p) => (p as any).type === 'impression');
  const affiliatePosts  = allPosts.filter((p) => (p as any).type !== 'impression');

  const impAvg = impressionPosts.length > 0
    ? impressionPosts.reduce((s, p) => s + score(p.metrics!), 0) / impressionPosts.length
    : null;
  const affAvg = affiliatePosts.length > 0
    ? affiliatePosts.reduce((s, p) => s + score(p.metrics!), 0) / affiliatePosts.length
    : 0;

  // インプ投稿が始まった時点を境に、宣伝投稿の平均スコアが改善しているか
  const sorted = [...affiliatePosts].sort((a, b) =>
    new Date(a.postedAt).getTime() - new Date(b.postedAt).getTime(),
  );
  const half = Math.floor(sorted.length / 2);
  const beforeAvg = half > 0
    ? sorted.slice(0, half).reduce((s, p) => s + score(p.metrics!), 0) / half
    : null;
  const afterAvg = half > 0
    ? sorted.slice(half).reduce((s, p) => s + score(p.metrics!), 0) / (sorted.length - half)
    : null;

  const trendText = (beforeAvg !== null && afterAvg !== null)
    ? `宣伝投稿スコア推移: 前半avg ${beforeAvg.toFixed(1)} → 後半avg ${afterAvg.toFixed(1)} (${afterAvg >= beforeAvg ? '📈改善' : '📉悪化'})`
    : 'トレンド計算中';

  const impText = impAvg !== null
    ? `インプ投稿avg ${impAvg.toFixed(1)} / 宣伝投稿avg ${affAvg.toFixed(1)}`
    : `インプ投稿データなし / 宣伝投稿avg ${affAvg.toFixed(1)}`;

  addHypothesis({
    id: 'impression-effect',
    question: 'インプ狙い投稿（10:30）の追加はアフィリ投稿のエンゲージメントを向上させているか？',
    status: (beforeAvg !== null && afterAvg !== null && afterAvg > beforeAvg) ? 'confirmed' : 'pending',
    finding: `${impText} / ${trendText}`,
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

  // 各仮説を検証（①〜④は外部監視と紐付くもの）
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
  _printHypotheses();
}

function _printHypotheses() {
  console.log('  📋 仮説状態:');
  for (const h of config.hypotheses) {
    const icon = h.status === 'confirmed' ? '✅' : h.status === 'rejected' ? '❌' : h.status === 'adjusted' ? '🔧' : '⏳';
    console.log(`    ${icon} [${h.id}] ${h.finding}`);
  }
}

// ─── 回復期研究仮説（シャドウバン解除後の政策決定のための知見蓄積）──────────

// R1: エンゲージメント型研究（どのインプ型が最もいいね・RTを得るか）
function evaluateResearchEngagement(): void {
  // インプ投稿は metrics 取得不可のため、内容タイプの多様性を確認
  const posts = getAllPosts();
  const impPosts = posts.filter((p) => (p as any).type === 'impression');

  addHypothesis({
    id: 'research-engagement',
    question: '【回復期研究①】どのインプ投稿スタイルが最もエンゲージメント（いいね・RT・リプ）を得やすいか？',
    status: 'pending',
    finding: impPosts.length > 0
      ? `インプ投稿実績 ${impPosts.length}件 蓄積中。指標は無料プランで取得不可のため手動観察が必要。観察ログ(/bot/observations)に記録してください。`
      : 'インプ投稿データなし。10:30スロットで蓄積開始。',
    adjustment: '回復後に採用予定: 最もエンゲージメントを得たスタイルを主力にする',
    testedAt: new Date().toISOString(),
  });
}

// R2: 良い作品研究（どの品質条件の作品が伸びるか）
function evaluateResearchProduct(): void {
  const posts = getAllPosts();
  const celPosts = posts.filter((p) => (p as any).type === 'celebrity');
  const titleKeywords = celPosts.map((p) => (p.item?.title ?? '').slice(0, 20));

  addHypothesis({
    id: 'research-product',
    question: '【回復期研究②】高評価×レビュー数×セール中のどの条件が「伸びる作品」を最もよく予測するか？',
    status: 'pending',
    finding: celPosts.length > 0
      ? `芸能人スロット投稿 ${celPosts.length}件 蓄積中。代表タイトル: ${titleKeywords.slice(-3).join(' / ')} 。観察ログに個別メモを記録してください。`
      : '芸能人スロットのデータ蓄積開始待ち。',
    adjustment: '回復後に採用予定: 品質スコア算式（レビュー数×評価×セール係数）を調整する',
    testedAt: new Date().toISOString(),
  });
}

// R3: 安全投稿研究（シャドウバン・凍結を回避するパターン）
function evaluateResearchSafePost(): void {
  const posts = getAllPosts();
  const recentPosts = posts.slice(-14); // 直近14件
  const hasImages = recentPosts.filter((p) => (p as any).text?.includes('🔞')).length;

  addHypothesis({
    id: 'research-safe-post',
    question: '【回復期研究③】どのコンテンツパターン（文体・絵文字・画像有無・リンクの有無）がシャドウバンを回避できるか？',
    status: 'pending',
    finding: recentPosts.length > 0
      ? `直近14件のうち🔞マーク含む投稿: ${hasImages}件。現状: 投稿1本/日(インプ) + 芸能人1本/日 = 2件体制継続中。観察ログにBAN回避ノウハウを記録してください。`
      : 'データ蓄積開始待ち。',
    adjustment: '回復後に採用予定: BANリスクが低いと判明したパターンを標準テンプレートに採用',
    testedAt: new Date().toISOString(),
  });
}

// ─── 日次評価（毎日 03:00 JST に実行）──────────────────────────────────────
//
// 監視サイクルとは独立して毎日実行。
// 仮説⑤⑥（コンテンツ型比較・インプ効果）を検証し、
// 翌日の投稿戦略に知見を反映する。
// 回復期研究仮説R1〜R3も記録・更新。

export async function runDailyEvaluation(): Promise<void> {
  const jst = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  console.log(`\n[${jst}] 🌙 日次戦略評価開始`);

  const decisions: string[] = [];

  // 既存仮説も再評価
  const d2 = evaluateTypeWeights();
  const d4 = evaluatePostingHours();
  if (d2) { console.log(`  ⚖️  [投稿重み] ${d2}`); decisions.push(d2); }
  if (d4) { console.log(`  🕐 [投稿時間] ${d4}`); decisions.push(d4); }

  // 新仮説⑤⑥を評価
  evaluateContentTypes();
  evaluateImpressionEffect();

  // 回復期研究仮説 R1〜R3（知見蓄積・状態更新）
  evaluateResearchEngagement();
  evaluateResearchProduct();
  evaluateResearchSafePost();

  console.log(`  ✅ 日次評価完了 (変更: ${decisions.length}件)`);
  config.lastEvaluatedAt = new Date().toISOString();
  config.version++;
  log(config.cycleStats.totalCycles, decisions.length > 0 ? decisions : ['日次評価完了 / 変更なし']);

  await saveConfig();
  _printHypotheses();
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

// ─── 会議決定事項からの設定変更API ───────────────────────────────────────────

export interface StrategyPatch {
  monitorIntervalHours?: number;
  typeWeights?: Partial<Record<string, number>>;
}

export async function patchStrategyConfig(patch: StrategyPatch, reason: string): Promise<string[]> {
  const changes: string[] = [];

  if (patch.monitorIntervalHours !== undefined) {
    const clamped = clamp(patch.monitorIntervalHours, 0.5, 24);
    if (clamped !== config.monitorIntervalHours) {
      changes.push(`監視間隔: ${config.monitorIntervalHours}h → ${clamped}h`);
      config.monitorIntervalHours = clamped;
    }
  }

  if (patch.typeWeights) {
    for (const [key, val] of Object.entries(patch.typeWeights)) {
      if (val !== undefined && config.typeWeights[key] !== undefined) {
        const clamped = clamp(val, 0, 5);
        changes.push(`投稿重み[${key}]: ${config.typeWeights[key]} → ${clamped}`);
        config.typeWeights[key] = clamped;
      }
    }
  }

  if (changes.length > 0) {
    log(config.cycleStats.totalCycles, [`[会議決定] ${reason}`, ...changes]);
    await saveConfig();
  }

  return changes;
}
