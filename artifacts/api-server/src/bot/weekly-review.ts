/**
 * weekly-review.ts
 * 週次AIレビュー — 過去7日間の投稿データをClaudeで分析し、
 * 改善案・危険表現・カテゴリ増減提案を出力する。
 */

import Anthropic from '@anthropic-ai/sdk';
import { readJson, writeJson } from './cloudStore.js';
import { getAnalytics, getAnalyticsStats } from './post-analytics.js';

const client = new Anthropic();

// ─── 型定義 ──────────────────────────────────────────────────────────────────

export interface WeeklyReviewResult {
  id: string;                      // YYYY-WXX 形式
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  stats: {
    total: number;
    posted: number;
    dryRun: number;
    failed: number;
    avgImpressions: number;
    avgLikes: number;
    topCategory: string;
    topTemplateCategory: string;
  };
  review: {
    winningPatterns: string[];      // 伸びた投稿の特徴（箇条書き）
    losingPatterns: string[];       // 伸びなかった投稿の特徴
    improvements: string[];         // 次週の改善案
    dangerousExpressions: string[]; // 危険だった表現（コンテンツポリシー観点）
    increaseCategories: string[];   // 増やすべきカテゴリ
    decreaseCategories: string[];   // 減らすべきカテゴリ
    summary: string;                // 全体サマリー（200字以内）
  };
  rawResponse: string;
}

interface WeeklyReviewsData {
  reviews: WeeklyReviewResult[];
}

let reviewsCache: WeeklyReviewsData = { reviews: [] };
let reviewsLoaded = false;

// ─── 永続化 ──────────────────────────────────────────────────────────────────

export async function loadWeeklyReviews(): Promise<void> {
  if (reviewsLoaded) return;
  reviewsCache = await readJson<WeeklyReviewsData>('weekly-reviews.json', { reviews: [] });
  reviewsLoaded = true;
}

function saveReviewsAsync(): void {
  writeJson('weekly-reviews.json', reviewsCache).catch((e: any) =>
    console.warn('  ⚠ weekly-reviews.json 保存失敗:', e.message),
  );
}

// ─── ISO週番号 ────────────────────────────────────────────────────────────────

function getISOWeekId(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ─── レビュー生成 ─────────────────────────────────────────────────────────────

export async function runWeeklyReview(force = false): Promise<WeeklyReviewResult> {
  await loadWeeklyReviews();

  const now = new Date();
  const weekId = getISOWeekId(now);

  if (!force) {
    const existing = reviewsCache.reviews.find(r => r.id === weekId);
    if (existing) {
      console.log(`  📊 [WeeklyReview] 今週のレビューは既に生成済み (${weekId})`);
      return existing;
    }
  }

  const periodEnd = now.toISOString();
  const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const stats = getAnalyticsStats(7);
  const records = getAnalytics(7);

  console.log(`  🤖 [WeeklyReview] AI分析開始 — 対象投稿 ${records.length}件 (${weekId})`);

  if (records.length === 0) {
    console.warn('  ⚠ [WeeklyReview] 対象期間内の投稿データなし — スキップ');
    const empty: WeeklyReviewResult = {
      id: weekId,
      generatedAt: now.toISOString(),
      periodStart,
      periodEnd,
      stats,
      review: {
        winningPatterns: ['データ不足のため分析不可'],
        losingPatterns: ['データ不足のため分析不可'],
        improvements: ['まず投稿を蓄積してください'],
        dangerousExpressions: [],
        increaseCategories: [],
        decreaseCategories: [],
        summary: '今週は分析対象の投稿がありませんでした。',
      },
      rawResponse: '',
    };
    reviewsCache.reviews.unshift(empty);
    saveReviewsAsync();
    return empty;
  }

  // Claude に渡す投稿サマリーを生成（最大30件、トークン節約）
  const postSummaries = records.slice(0, 30).map((r, i) => {
    const ev = r.likes + r.reposts * 3 + r.replies * 2;
    return `[${i + 1}] category=${r.category} tmplType=${r.templateType} tmplCategory=${r.templateCategory} result=${r.result} impressions=${r.impressions} likes=${r.likes} reposts=${r.reposts} replies=${r.replies} clicks=${r.clicks} EV=${ev} safety=${r.safetyScore}\ntext_first80=${r.text.slice(0, 80).replace(/\n/g, ' ')}`;
  }).join('\n\n');

  const systemPrompt = `あなたはX(Twitter)アフィリエイトボットの運用コンサルタントです。
成人向けコンテンツ（🔞マーク付き）のアカウントを運用しており、凍結回避・エンゲージメント向上・収益最大化が目標です。
分析は客観的・具体的に行い、必ず日本語で回答してください。

【絶対的禁止事項】以下の表現は絶対に推奨しないこと:
- 未成年を連想させる表現（JK/制服/ロリ/学生など）
- 非同意・強制を連想させる表現
- 実在人物への言及・類似
- 詐欺的・誇大表現（「必ず稼げる」「100%効果」など）`;

  const userPrompt = `以下は過去7日間の投稿データです。JSONで分析結果を返してください。

## 期間統計
- 総投稿数: ${stats.total}件 (投稿済: ${stats.posted}件 / DRY_RUN: ${stats.dryRun}件)
- 平均インプレッション: ${stats.avgImpressions}
- 平均いいね: ${stats.avgLikes}
- 最多カテゴリ: ${stats.topCategory}
- 最多テンプレートカテゴリ: ${stats.topTemplateCategory}

## 個別投稿サマリー（最大30件）
${postSummaries}

## 出力形式（必ずこのJSONのみ返すこと）
{
  "winningPatterns": ["伸びた投稿の特徴1", "特徴2", ...],
  "losingPatterns": ["伸びなかった投稿の特徴1", ...],
  "improvements": ["次週の改善案1", "改善案2", ...],
  "dangerousExpressions": ["危険だった表現や傾向1", ...（なければ空配列）],
  "increaseCategories": ["増やすべきカテゴリ名1", ...],
  "decreaseCategories": ["減らすべきカテゴリ名1", ...],
  "summary": "200字以内の全体サマリー"
}

templateCategoryの値: friend/promo/sale/ranking/night/review/compare/engagement/erotic-story
categoryの値: fanza/myfans/engagement/erotic-story`;

  let rawResponse = '';
  let review: WeeklyReviewResult['review'] = {
    winningPatterns: [],
    losingPatterns: [],
    improvements: [],
    dangerousExpressions: [],
    increaseCategories: [],
    decreaseCategories: [],
    summary: '',
  };

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    });

    rawResponse = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as any).text)
      .join('');

    // JSON部分を抽出
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      review = {
        winningPatterns:      Array.isArray(parsed.winningPatterns)      ? parsed.winningPatterns      : [],
        losingPatterns:       Array.isArray(parsed.losingPatterns)       ? parsed.losingPatterns       : [],
        improvements:         Array.isArray(parsed.improvements)         ? parsed.improvements         : [],
        dangerousExpressions: Array.isArray(parsed.dangerousExpressions) ? parsed.dangerousExpressions : [],
        increaseCategories:   Array.isArray(parsed.increaseCategories)   ? parsed.increaseCategories   : [],
        decreaseCategories:   Array.isArray(parsed.decreaseCategories)   ? parsed.decreaseCategories   : [],
        summary:              typeof parsed.summary === 'string'         ? parsed.summary              : '',
      };
    }

    console.log(`  ✅ [WeeklyReview] AI分析完了 (${weekId})`);
  } catch (e: any) {
    console.error(`  ❌ [WeeklyReview] AI分析エラー: ${e.message}`);
    review.summary = `分析中にエラーが発生しました: ${e.message}`;
    review.improvements = ['エラーのため自動改善案を生成できませんでした'];
  }

  const result: WeeklyReviewResult = {
    id: weekId,
    generatedAt: now.toISOString(),
    periodStart,
    periodEnd,
    stats,
    review,
    rawResponse,
  };

  // 先頭に追加（最新が先頭）
  reviewsCache.reviews = [result, ...reviewsCache.reviews.filter(r => r.id !== weekId)];
  // 最大52週分保持
  if (reviewsCache.reviews.length > 52) reviewsCache.reviews = reviewsCache.reviews.slice(0, 52);
  saveReviewsAsync();

  return result;
}

export function getLatestWeeklyReview(): WeeklyReviewResult | null {
  return reviewsCache.reviews[0] ?? null;
}

export function getAllWeeklyReviews(): WeeklyReviewResult[] {
  return reviewsCache.reviews;
}
