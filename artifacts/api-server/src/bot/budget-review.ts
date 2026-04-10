/**
 * budget-review.ts — 月次予算会議
 *
 * 月1回、全APIコストを集計・評価し、翌月の予算配分を決定する。
 * 決定内容は strategy-config.json と Google Sheets に書き込み、
 * 週次会議（auto-meeting.ts）の冒頭ブリーフィングにも引き継がれる。
 *
 * 【対象コスト】
 *   A. X API（書き込み: $0.01/POST / 読み取り: $0.005/tweet）
 *   B. AI API（Grok / GPT-4o-mini / Claude Sonnet / Claude Haiku）
 *
 * 【月次上限ガイドライン】
 *   X API:  $21/月（$0.70/日）
 *   AI API:  $3/月（$0.10/日）
 *   合計:   $24/月（$0.80/日）
 */

import OpenAI from 'openai';
import { readJson, writeJson } from './cloudStore.js';
import { getAllPosts } from './storage.js';
import { contact } from './contact.js';
import { appendAccountMetrics, isSheetsConfigured } from './sheets-writer.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── 料金テーブル（2026年最新） ──────────────────────────────────────────────

const RATE = {
  x: {
    write:  0.01,    // $/ POST（ツイート投稿・リプライ）
    read:   0.005,   // $/ tweet（検索結果・指標取得1件）
  },
  ai: {
    'gpt-4o':           { input: 2.50  / 1e6, output: 10.00 / 1e6 },
    'gpt-4o-mini':      { input: 0.15  / 1e6, output: 0.60  / 1e6 },
    'claude-sonnet-4-5':{ input: 3.00  / 1e6, output: 15.00 / 1e6 },
    'claude-haiku-4-5': { input: 1.00  / 1e6, output: 5.00  / 1e6 },
    'grok-4.1-fast':    { input: 0.20  / 1e6, output: 0.50  / 1e6 },
  } as Record<string, { input: number; output: number }>,
};

// ─── 1オペレーションあたりのトークン見積もり ─────────────────────────────────

const OP_TOKENS = {
  dailyMeeting: [
    { model: 'grok-4.1-fast',     input: 3000, output:  500 },
    { model: 'gpt-4o-mini',       input: 5000, output: 1000 },
    { model: 'claude-sonnet-4-5', input: 8000, output: 1500 },
  ],
  tweetGen: [
    { model: 'claude-haiku-4-5',  input: 3000, output:  500 },
  ],
  templateEvolve: [
    { model: 'claude-haiku-4-5',  input: 5000, output: 2000 },
  ],
  celebSelect: [
    { model: 'gpt-4o-mini',       input: 2000, output:  500 },
  ],
  weeklyMeeting: [
    { model: 'grok-4.1-fast',     input: 5000, output: 1000 },
    { model: 'gpt-4o',            input:20000, output: 5000 },
    { model: 'claude-sonnet-4-5', input:10000, output: 2000 },
  ],
  budgetMeeting: [
    { model: 'gpt-4o-mini',       input: 4000, output: 1500 },
  ],
};

function calcAiCost(ops: typeof OP_TOKENS.dailyMeeting, count: number): number {
  return ops.reduce((sum, o) => {
    const r = RATE.ai[o.model] ?? { input: 0, output: 0 };
    return sum + (o.input * r.input + o.output * r.output) * count;
  }, 0);
}

// ─── 月次コスト推計 ───────────────────────────────────────────────────────────

export interface BudgetEstimate {
  periodDays: number;
  posts: number;
  xWriteCost:  number;   // 投稿・リプライ
  xReadCost:   number;   // 検索・指標
  xTotal:      number;
  aiMeetingCost:  number;
  aiGenerateCost: number;
  aiTemplateCost: number;
  aiWeeklyCost:   number;
  aiBudgetCost:   number;
  aiTotal:     number;
  grandTotal:  number;
  dailyAvg:    number;
  budgetStatus: 'OK' | 'WARN' | 'OVER';
}

export async function estimateMonthlyCost(periodDays = 30): Promise<BudgetEstimate> {
  const posts = getAllPosts();
  const recentPosts = posts.filter(p => {
    const age = (Date.now() - new Date(p.postedAt).getTime()) / 86400000;
    return age <= periodDays;
  });
  const postCount = recentPosts.length;

  // X API: 投稿1本=本文+リプライ2本=3 WRITE、指標更新=7 READ/日（W2以降）
  const xWriteCost  = postCount * 3 * RATE.x.write;
  const monitorCyclesPerDay = 3;    // 8h間隔
  const searchTweetsPerCycle = 40;  // 4クエリ×10件
  const xReadSearch = periodDays * monitorCyclesPerDay * searchTweetsPerCycle * RATE.x.read;
  const xReadMetrics = periodDays * 7 * RATE.x.read;   // 投稿指標（W2以降）
  const xReadCost   = xReadSearch + xReadMetrics;
  const xTotal      = xWriteCost + xReadCost;

  // AI API
  const aiMeetingCost  = calcAiCost(OP_TOKENS.dailyMeeting,  postCount);
  const aiGenerateCost = calcAiCost(OP_TOKENS.tweetGen,       postCount);
  const aiTemplateCost = calcAiCost(OP_TOKENS.templateEvolve, periodDays * 3);
  const aiWeeklyCost   = calcAiCost(OP_TOKENS.weeklyMeeting,  Math.floor(periodDays / 7));
  const aiBudgetCost   = calcAiCost(OP_TOKENS.budgetMeeting,  1);
  const aiTotal        = aiMeetingCost + aiGenerateCost + aiTemplateCost + aiWeeklyCost + aiBudgetCost;

  const grandTotal = xTotal + aiTotal;
  const dailyAvg   = grandTotal / periodDays;

  const budgetStatus: BudgetEstimate['budgetStatus'] =
    dailyAvg > 1.20 ? 'OVER' :
    dailyAvg > 0.90 ? 'WARN' : 'OK';

  return {
    periodDays, posts: postCount,
    xWriteCost, xReadCost, xTotal,
    aiMeetingCost, aiGenerateCost, aiTemplateCost, aiWeeklyCost, aiBudgetCost, aiTotal,
    grandTotal, dailyAvg, budgetStatus,
  };
}

// ─── 予算決定ファイル ─────────────────────────────────────────────────────────

export interface BudgetDecision {
  decidedAt: string;
  periodDays: number;
  estimate: BudgetEstimate;
  decision: string;           // GPTが決定した要約
  adjustments: string[];      // 具体的な調整内容
  nextMonthGuideline: string; // 翌月の行動指針
}

// ─── 月次予算会議メイン ───────────────────────────────────────────────────────

export async function runBudgetReview(): Promise<BudgetDecision> {
  console.log('\n💰 [月次予算会議] 開始');

  const est = await estimateMonthlyCost(30);

  const prompt = `あなたはFANZAアフィリエイトXボットの「予算担当AI」です。
以下の直近30日間の実績コストを分析し、翌月の予算配分を決定してください。

【料金テーブル（2026年最新）】
X API:
  - ツイート投稿/リプライ: $0.01/件
  - 検索・指標読み取り:   $0.005/tweet
AI API:
  - Grok 4.1 Fast:        $0.20/Mトークン(in) / $0.50/Mトークン(out)
  - GPT-4o:               $2.50/M(in) / $10.00/M(out)
  - GPT-4o-mini:          $0.15/M(in) / $0.60/M(out)
  - Claude Sonnet 4.5:    $3.00/M(in) / $15.00/M(out)
  - Claude Haiku 4.5:     $1.00/M(in) / $5.00/M(out)

【直近30日 実績・推計】
- 投稿数: ${est.posts}件
- X API合計: $${est.xTotal.toFixed(3)}
  ├ 投稿コスト: $${est.xWriteCost.toFixed(3)}
  └ 読み取り（検索+指標）: $${est.xReadCost.toFixed(3)}
- AI API合計: $${est.aiTotal.toFixed(3)}
  ├ 3者会議（日次）: $${est.aiMeetingCost.toFixed(3)}
  ├ ツイート生成: $${est.aiGenerateCost.toFixed(3)}
  ├ テンプレート進化（3回/日）: $${est.aiTemplateCost.toFixed(3)}
  ├ 週次会議: $${est.aiWeeklyCost.toFixed(3)}
  └ 予算会議（本会議）: $${est.aiBudgetCost.toFixed(3)}
- 月間合計: $${est.grandTotal.toFixed(3)}
- 日次平均: $${est.dailyAvg.toFixed(3)}
- 予算状況: ${est.budgetStatus === 'OK' ? '✅ OK（$1/日以内）' : est.budgetStatus === 'WARN' ? '⚠️ 注意（$0.90〜$1.20/日）' : '🚨 超過（$1.20/日超）'}

【月次上限ガイドライン】
- 日次上限: $1.00
- X API: $0.70/日（外部パターン収集が最大消費）
- AI API: $0.30/日（3者会議+生成が主）

以下の形式で回答してください：

【評価】
（現在のコスト状況を2〜3文で評価）

【翌月の調整事項】
1. （具体的な調整 — 変更なし/削減/強化）
2. ...

【翌月の行動指針】
（翌月の予算運用方針を1文で）`;

  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 600,
    temperature: 0.3,
  });

  const raw = res.choices[0].message.content ?? '';

  const evalMatch   = raw.match(/【評価】\n?([\s\S]*?)(?=【|$)/);
  const adjMatch    = raw.match(/【翌月の調整事項】\n?([\s\S]*?)(?=【|$)/);
  const guideMatch  = raw.match(/【翌月の行動指針】\n?([\s\S]*?)(?=【|$)/);

  const decision    = evalMatch?.[1]?.trim() ?? raw.slice(0, 200);
  const adjText     = adjMatch?.[1]?.trim() ?? '';
  const guideline   = guideMatch?.[1]?.trim() ?? '';
  const adjustments = adjText
    .split('\n')
    .map(l => l.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);

  const result: BudgetDecision = {
    decidedAt: new Date().toISOString(),
    periodDays: 30,
    estimate: est,
    decision,
    adjustments,
    nextMonthGuideline: guideline,
  };

  await writeJson('budget-decision.json', result);
  console.log(`  ✅ [予算会議] 完了: 月間推計 $${est.grandTotal.toFixed(2)} / 日次 $${est.dailyAvg.toFixed(3)}`);
  console.log(`  📋 決定: ${decision.slice(0, 80)}...`);

  // Google Sheets — AccountMetrics タブに記録
  if (isSheetsConfigured()) {
    try {
      await appendAccountMetrics({
        recordedAt: new Date().toISOString(),
        followers: 0,
        tweetCount: est.posts,
        avgLikes: 0,
        avgImpressions: 0,
        note: `[予算会議] 月間推計$${est.grandTotal.toFixed(2)} / 日次$${est.dailyAvg.toFixed(3)} / ${est.budgetStatus}`,
      });
    } catch (e: any) {
      console.warn('  ⚠ [予算会議] Sheets書き込み失敗:', e.message);
    }
  }

  // メール通知
  await contact({
    level: est.budgetStatus === 'OVER' ? 'WARN' : 'INFO',
    title: `💰 月次予算会議完了 — ${est.budgetStatus}`,
    body: `【直近30日 推計コスト】
X API:      $${est.xTotal.toFixed(3)}（投稿$${est.xWriteCost.toFixed(3)} / 読取$${est.xReadCost.toFixed(3)}）
AI API:     $${est.aiTotal.toFixed(3)}（会議$${est.aiMeetingCost.toFixed(3)} / 生成$${est.aiGenerateCost.toFixed(3)} / テンプレ$${est.aiTemplateCost.toFixed(3)}）
月間合計:    $${est.grandTotal.toFixed(3)}（日次平均 $${est.dailyAvg.toFixed(3)}）
予算状況:    ${est.budgetStatus}

【評価】
${decision}

【翌月の調整事項】
${adjustments.map((a, i) => `${i + 1}. ${a}`).join('\n')}

【翌月の行動指針】
${guideline}`,
  });

  return result;
}

// ─── 最新の予算決定を取得（週次会議ブリーフィング用） ─────────────────────────

export async function getLatestBudgetDecision(): Promise<BudgetDecision | null> {
  return readJson<BudgetDecision | null>('budget-decision.json', null);
}

// ─── 予算サマリー文字列（週次会議に埋め込み用） ────────────────────────────────

export async function getBudgetBriefing(): Promise<string> {
  const dec = await getLatestBudgetDecision();
  if (!dec) return '（予算会議未実施 — 月次自動実行を待機中）';

  const est = dec.estimate;
  const age = Math.floor((Date.now() - new Date(dec.decidedAt).getTime()) / 86400000);
  return `【最新予算会議 (${age}日前)】
月間推計: $${est.grandTotal.toFixed(2)} / 日次: $${est.dailyAvg.toFixed(3)} / 状況: ${est.budgetStatus}
翌月指針: ${dec.nextMonthGuideline}`;
}
