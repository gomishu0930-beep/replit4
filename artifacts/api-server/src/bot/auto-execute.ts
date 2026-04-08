/**
 * auto-execute.ts — 自律実行エンジン
 *
 * ユーザーから全権委任された自律運営モジュール。
 * - 会議室決定事項の完全自動実行（担当者問わず）
 * - アルゴリズム推奨の自動戦略適用
 * - A/Bテスト結果の自動判定と次フェーズ決定
 */

import Anthropic from '@anthropic-ai/sdk';
import { getXActiveDirectives, saveDirectiveExecution, updateDirectiveStatus, addDirective } from './meeting.js';
import { executeDirective } from './directive-executor.js';
import { getStats, getPostsAfter } from './storage.js';
import { patchStrategyConfig } from './strategy.js';
import { contact } from './contact.js';

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? 'dummy',
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

// ─── 自律モード設定 ──────────────────────────────────────────────────────────

export const AUTONOMY_GRANTED_AT = '2026-04-07T00:00:00+09:00';

export interface AutoExecResult {
  runAt: string;
  total: number;
  executed: number;
  succeeded: number;
  skipped: number;
  results: Array<{
    id: string;
    text: string;
    actionType: string;
    result: string;
    success: boolean;
  }>;
}

// ─── 1. 会議室決定事項の完全自動実行 ─────────────────────────────────────────

/**
 * AI担当のアクティブ指令のみを自動実行
 * user/others 担当はスキップ（ユーザーが手動で確認するタスク）
 * 毎朝 07:30 JST にスケジューラーから呼び出す
 */
export async function runAutoDirectiveExecution(): Promise<AutoExecResult> {
  // ⚠️ X専用指令のみ取得。Threadsの決定事項はXボットに適用しない（platform分離）
  const allDirectives = getXActiveDirectives();
  const directives = allDirectives.filter(d => (d.assignee ?? 'ai') === 'ai');
  const userSkipped = allDirectives.filter(d => (d.assignee ?? 'ai') !== 'ai');
  const runAt = new Date().toISOString();

  if (directives.length === 0) {
    console.log(`  ✅ [自律実行] X担当AI指令なし — スキップ (user担当: ${userSkipped.length}件は手動確認待ち)`);
    return { runAt, total: allDirectives.length, executed: 0, succeeded: 0, skipped: userSkipped.length, results: [] };
  }

  console.log(`\n  🤖 [自律実行・X専用] AI担当 ${directives.length}件を処理開始... (user担当 ${userSkipped.length}件はスキップ)`);

  const results: AutoExecResult['results'] = [];
  let executed = 0, succeeded = 0, skipped = userSkipped.length;

  for (const directive of directives) {
    try {
      console.log(`  → [${directive.category}] ${directive.text.slice(0, 50)}...`);
      const execution = await executeDirective(directive);
      await saveDirectiveExecution(directive.id, execution);

      if (execution.actionType === 'no-op') {
        skipped++;
        results.push({
          id: directive.id,
          text: directive.text.slice(0, 80),
          actionType: 'no-op',
          result: execution.summary,
          success: false,
        });
      } else {
        executed++;
        if (execution.success) {
          succeeded++;
          await updateDirectiveStatus(directive.id, 'completed');
          console.log(`  ✅ [自律実行] 完了: ${execution.summary}`);
        } else {
          console.log(`  ⚠ [自律実行] 失敗: ${execution.summary}`);
        }
        results.push({
          id: directive.id,
          text: directive.text.slice(0, 80),
          actionType: execution.actionType,
          result: execution.summary,
          success: execution.success,
        });
      }
    } catch (e: any) {
      console.error(`  ❌ [自律実行] エラー: ${e.message}`);
      results.push({
        id: directive.id,
        text: directive.text.slice(0, 80),
        actionType: 'error',
        result: e.message,
        success: false,
      });
    }
  }

  const summary = { runAt, total: directives.length, executed, succeeded, skipped, results };

  // 実行結果を通知
  if (executed > 0) {
    const successLines = results.filter(r => r.success).map(r => `✅ ${r.text.slice(0, 40)}: ${r.result}`);
    const failLines = results.filter(r => !r.success && r.actionType !== 'no-op').map(r => `⚠ ${r.text.slice(0, 40)}: ${r.result}`);
    const skipLines = results.filter(r => r.actionType === 'no-op').map(r => `↩ ${r.text.slice(0, 40)}（手動対応）`);

    await contact.systemAlert(
      `🤖 自律実行完了 (${succeeded}/${executed}件成功)`,
      [
        `処理: ${directives.length}件 | 実行: ${executed}件 | 成功: ${succeeded}件 | 手動: ${skipped}件`,
        ...successLines.slice(0, 3),
        ...failLines.slice(0, 2),
        ...skipLines.slice(0, 2),
      ].join('\n'),
    );
  }

  return summary;
}

// ─── 2. アルゴリズム推奨の自動戦略適用 ───────────────────────────────────────

/**
 * アルゴ解析ブリーフィングから具体的な推奨を抽出し戦略に自動適用
 * runAlgoAnalysis() の直後に呼び出す
 */
export async function applyAlgoRecommendations(
  briefing: string,
  discussion?: { claudeHypothesis: string; o3Challenge: string; claudeSynthesis: string },
): Promise<{ applied: boolean; changes: string[]; summary: string }> {
  if (!briefing || briefing.length < 50) {
    return { applied: false, changes: [], summary: 'ブリーフィング不十分' };
  }

  const synthesisText = discussion?.claudeSynthesis ?? '';

  const prompt = `あなたはFANZAアフィリエイトXボットの戦略自動適用エンジンです。
以下のアルゴリズム解析レポートを読み、今すぐ設定に反映すべき変更を抽出してください。

【ブリーフィング（統計サマリ）】
${briefing.slice(0, 1500)}

【Claudeの総合判断】
${synthesisText.slice(0, 800)}

【ルール】
- 「〜を強化」「〜を増やす」「〜を優先」など具体的な推奨のみ抽出
- typeWeights は buzz/amateur/rank/sale/random のみ（0〜5の数値）
- 根拠が弱い推奨は shouldUpdate: false にする
- 変更は保守的に（既存値から±1以内が目安）

以下のJSONフォーマットのみ返してください（コードブロック不要）:
{
  "shouldUpdate": true,
  "reason": "変更理由（1文）",
  "patch": {
    "typeWeights": { "buzz": 2.5 }
  }
}`;

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = resp.content[0].type === 'text' ? resp.content[0].text : '{}';
    const parsed = JSON.parse(raw.replace(/```json?\n?|```/g, '').trim());

    if (!parsed.shouldUpdate) {
      console.log(`  ℹ️ [アルゴ自動適用] 変更不要: ${parsed.reason}`);
      return { applied: false, changes: [], summary: parsed.reason ?? '変更不要' };
    }

    const changes = await patchStrategyConfig(parsed.patch ?? {}, `アルゴ解析自動適用: ${parsed.reason}`);
    const summary = changes.length > 0
      ? `${changes.length}項目を自動更新: ${changes.join(', ')}`
      : '変更不要（既に最適）';

    console.log(`  ✅ [アルゴ自動適用] ${summary}`);
    return { applied: changes.length > 0, changes, summary };
  } catch (e: any) {
    console.warn(`  ⚠ [アルゴ自動適用] エラー: ${e.message}`);
    return { applied: false, changes: [], summary: `エラー: ${e.message}` };
  }
}

// ─── 3. A/Bテスト自動判定 ────────────────────────────────────────────────────

export interface ABTestDecision {
  decidedAt: string;
  w1Metrics: { avgImpression: number; count: number };
  w2Metrics: { avgImpression: number; count: number };
  winner: 'W1' | 'W2' | 'inconclusive';
  winnerTime: string;
  recommendation: string;
  applied: boolean;
}

/**
 * W1(10:30) vs W2(05:00) の結果を評価し勝者を自動決定
 * W2終了後（4/21以降）に1回だけ実行
 */
export async function runABTestDecision(): Promise<ABTestDecision | null> {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 3600000);

  // W2終了日(4/20)以前は実行しない
  const w2End = new Date('2026-04-20T23:59:59+09:00');
  if (now < w2End) {
    console.log('  ℹ️ [A/Bテスト判定] W2期間中のため判定スキップ');
    return null;
  }

  // W1期間(4/7-4/13): 20:00 JST プライムタイムの投稿
  const w1Start = new Date('2026-04-07T00:00:00+09:00');
  const w1End   = new Date('2026-04-13T23:59:59+09:00');
  // W2期間(4/14-4/20): 05:00 JSTの投稿
  const w2Start = new Date('2026-04-14T00:00:00+09:00');

  const allPosts = getPostsAfter(w1Start);
  const w1Posts = allPosts.filter(p => {
    const d = new Date(p.postedAt);
    return d >= w1Start && d <= w1End && p.metrics?.impression_count;
  });
  const w2Posts = allPosts.filter(p => {
    const d = new Date(p.postedAt);
    return d >= w2Start && d <= w2End && p.metrics?.impression_count;
  });

  const avgImp = (posts: typeof allPosts) =>
    posts.length === 0
      ? 0
      : posts.reduce((s, p) => s + (p.metrics?.impression_count ?? 0), 0) / posts.length;

  const w1Avg = avgImp(w1Posts);
  const w2Avg = avgImp(w2Posts);
  const decidedAt = jst.toISOString();

  console.log(`  📊 [A/Bテスト判定] W1: ${w1Avg.toFixed(0)}imp×${w1Posts.length}件 / W2: ${w2Avg.toFixed(0)}imp×${w2Posts.length}件`);

  let winner: 'W1' | 'W2' | 'inconclusive' = 'inconclusive';
  let winnerTime = '未定';
  let recommendation = '';
  let applied = false;

  const minSamples = 3;
  if (w1Posts.length < minSamples || w2Posts.length < minSamples) {
    recommendation = `サンプル不足 (W1:${w1Posts.length}件, W2:${w2Posts.length}件) → 18-22時スロットへ移行`;
    winner = 'inconclusive';
    winnerTime = '18-22 JST（デフォルト）';
  } else {
    const diff = (w1Avg - w2Avg) / Math.max(w2Avg, 1);
    if (diff > 0.15) {
      winner = 'W1';
      winnerTime = '20:00 JST';
      recommendation = `W1(20:00)がW2(05:00)より${(diff * 100).toFixed(0)}%高インプレッション → 20:00投稿を推奨`;
    } else if (diff < -0.15) {
      winner = 'W2';
      winnerTime = '05:00 JST';
      recommendation = `W2(05:00)がW1(20:00)より${Math.abs(diff * 100).toFixed(0)}%高インプレッション → 05:00投稿を推奨`;
    } else {
      winner = 'inconclusive';
      winnerTime = '18-22 JST（差異なし）';
      recommendation = `W1/W2の差異が±15%未満 → デフォルト時間帯(18-22時)を継続推奨`;
    }
  }

  // 決定事項として会議室に保存
  await addDirective(
    `【A/Bテスト自動判定】${recommendation} (W1: avg ${w1Avg.toFixed(0)}imp/${w1Posts.length}件 / W2: avg ${w2Avg.toFixed(0)}imp/${w2Posts.length}件)`,
    'timing',
    'high',
    '自律実行エンジン - A/Bテスト判定',
    'ai',
  );
  applied = true;

  await contact.systemAlert(
    `🧪 A/Bテスト判定完了: ${winner === 'inconclusive' ? '差異なし' : winner + ' 勝利'}`,
    recommendation,
  );

  return {
    decidedAt, w1Metrics: { avgImpression: w1Avg, count: w1Posts.length },
    w2Metrics: { avgImpression: w2Avg, count: w2Posts.length },
    winner, winnerTime, recommendation, applied,
  };
}
