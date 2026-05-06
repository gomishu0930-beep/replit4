import { randomUUID } from 'crypto';
import type {
  AgentRun,
  AgentRunInput,
  AgentRunOutput,
  ClaudeFlowDiagnostic,
  DraftProposal,
  MarketComparisonSummary,
  MarketPost,
  MediaType,
  OwnPostComparison,
  RankedMarketPost,
  RiskFlag,
} from './agent-types.js';
import { calculateGrowthScore } from './growth-score.js';
import { runComplianceGuard } from './compliance-guard.js';
import { getAllPosts } from './storage.js';
import { getAnalytics } from './post-analytics.js';
import { fetchUserTimelineMarketPage, searchMarketTweetsPage } from './twitter.js';
import { startAgentRun, finishAgentRun, getAgentRun, getAgentRuns } from './agent-run-store.js';
import { getAnalysisAdapterStatus } from './analysis-adapter.js';
import {
  buildLearningSignals,
  buildMediaRecommendations,
  buildRecommendationSchema,
  buildScheduleRecommendations,
  classifyMarketPosts,
  classifyOwnPostPattern,
  extractOwnAccountGaps,
  generateImprovedDraftProposals,
  scoreFanzaWorkCandidates,
  summarizeWinningPatterns,
} from './posting-improvement.js';

const DEFAULT_KEYWORDS = ['FANZA', 'DMM', 'アダルト おすすめ'];
const DEFAULT_GENRES = ['人妻', 'OL', '素人', '巨乳', 'セール'];

export function normalizeAgentInput(raw: Partial<AgentRunInput> = {}): AgentRunInput {
  const envAccounts = (process.env.TRACK_ACCOUNTS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^@/, ''))
    .filter(Boolean);
  return {
    keywords: Array.isArray(raw.keywords) && raw.keywords.length > 0
      ? raw.keywords.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 10)
      : DEFAULT_KEYWORDS,
    genres: Array.isArray(raw.genres) && raw.genres.length > 0
      ? raw.genres.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 10)
      : DEFAULT_GENRES,
    accounts: Array.isArray(raw.accounts) && raw.accounts.length > 0
      ? raw.accounts.map(String).map((s) => s.trim().replace(/^@/, '')).filter(Boolean).slice(0, 20)
      : envAccounts,
    maxResults: Math.min(Math.max(Number(raw.maxResults ?? 200), 10), 500),
    ownDays: Math.min(Math.max(Number(raw.ownDays ?? 30), 1), 180),
    proposalCount: Math.min(Math.max(Number(raw.proposalCount ?? 5), 1), 10),
  };
}

function extractHashtags(text: string): string[] {
  return [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1]).slice(0, 10);
}

function inferGenre(text: string, fallback = 'general'): string {
  const candidates = ['人妻', 'OL', '素人', '巨乳', '熟女', 'ギャル', 'セール', 'ランキング', 'レビュー', '動画'];
  return candidates.find((g) => text.includes(g)) ?? fallback;
}

function inferAppealAxis(text: string): string {
  if (/セール|割引|OFF|お得|限定/.test(text)) return 'sale';
  if (/レビュー|評価|件|★|⭐/.test(text)) return 'review-proof';
  if (/ランキング|人気|上位/.test(text)) return 'ranking-proof';
  if (/見つけ|発見|知らなかった/.test(text)) return 'discovery';
  if (/どっち|好き|教えて|？|\?/.test(text)) return 'question';
  if (/夜|深夜|眠れ/.test(text)) return 'night-emotion';
  return 'casual-recommendation';
}

function jstHour(iso: string): number {
  const d = new Date(iso);
  return (d.getUTCHours() + 9) % 24;
}

function estimateMediaType(record: { imageUsed?: boolean; text?: string; url?: string; shortUrl?: string }): MediaType {
  if (record.imageUsed) return 'photo';
  return 'none';
}

function toMarketPost(raw: any, source: string): MarketPost {
  const text = raw.text ?? '';
  return {
    post_id: raw.id,
    author_id: raw.authorId ?? raw.author_id ?? '',
    username: raw.username ?? '',
    text,
    created_at: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
    public_metrics: {
      like_count: raw.like_count ?? raw.public_metrics?.like_count ?? 0,
      retweet_count: raw.retweet_count ?? raw.public_metrics?.retweet_count ?? 0,
      reply_count: raw.reply_count ?? raw.public_metrics?.reply_count ?? 0,
      quote_count: raw.quote_count ?? raw.public_metrics?.quote_count ?? 0,
      bookmark_count: raw.bookmark_count ?? raw.public_metrics?.bookmark_count ?? 0,
      impression_count: raw.impression_count ?? raw.public_metrics?.impression_count ?? 0,
    },
    media_type: raw.media_type ?? 'none',
    has_url: Boolean(raw.has_url ?? /https?:\/\/\S+/i.test(text)),
    possibly_sensitive: Boolean(raw.possibly_sensitive),
    hashtags: raw.hashtags ?? extractHashtags(text),
    collected_at: new Date().toISOString(),
    author_followers_count: raw.author_followers_count,
    source,
  };
}

export async function scanMarket(input: AgentRunInput): Promise<{ posts: RankedMarketPost[]; risks: RiskFlag[]; errors: string[] }> {
  const dedup = new Map<string, MarketPost>();
  const errors: string[] = [];
  const risks: RiskFlag[] = [];
  const queries = [...input.keywords, ...input.genres.map((g) => `FANZA ${g}`)]
    .filter(Boolean)
    .slice(0, 16);
  const perSourceLimit = Math.max(20, Math.ceil(input.maxResults / Math.max(queries.length + input.accounts.length, 1)));

  for (const query of queries) {
    let nextToken: string | undefined;
    let fetchedForQuery = 0;
    for (let page = 0; page < 6 && dedup.size < input.maxResults && fetchedForQuery < perSourceLimit; page++) {
      const pageResult = await searchMarketTweetsPage(query, Math.min(100, perSourceLimit - fetchedForQuery), nextToken);
      errors.push(...pageResult.errors);
      for (const raw of pageResult.tweets) {
        const post = toMarketPost(raw, query);
        dedup.set(post.post_id, post);
      }
      fetchedForQuery += pageResult.tweets.length;
      nextToken = pageResult.nextToken;
      if (!nextToken || pageResult.tweets.length === 0) break;
    }
  }

  for (const account of input.accounts) {
    let nextToken: string | undefined;
    let fetchedForAccount = 0;
    for (let page = 0; page < 6 && dedup.size < input.maxResults && fetchedForAccount < perSourceLimit; page++) {
      const pageResult = await fetchUserTimelineMarketPage(account, Math.min(100, perSourceLimit - fetchedForAccount), nextToken);
      errors.push(...pageResult.errors);
      for (const raw of pageResult.tweets) {
        const post = toMarketPost(raw, `@${account}`);
        dedup.set(post.post_id, post);
      }
      fetchedForAccount += pageResult.tweets.length;
      nextToken = pageResult.nextToken;
      if (!nextToken || pageResult.tweets.length === 0) break;
    }
  }

  if (dedup.size < Math.min(input.maxResults, 50)) {
    risks.push({
      code: 'market_data_underfilled',
      severity: 'warning',
      message: `市場投稿の取得数が少なめです (${dedup.size}/${input.maxResults})。X API権限、検索プラン、TRACK_ACCOUNTSを確認してください`,
    });
  }
  for (const error of errors.slice(0, 5)) {
    risks.push({ code: 'x_api_collection_error', severity: 'warning', message: error });
  }

  const ranked = [...dedup.values()]
    .map((post) => {
      const score = calculateGrowthScore(post);
      return {
        ...post,
        growth_score: score.score,
        growth_reason: score.reasons,
        engagement_rate: score.engagementRate,
        age_hours: score.ageHours,
      };
    })
    .sort((a, b) => b.growth_score - a.growth_score)
    .slice(0, input.maxResults);

  return { posts: ranked, risks, errors };
}

export function buildOwnPostComparisons(days: number): OwnPostComparison[] {
  const analytics = getAnalytics(days);
  const storedPosts = new Map(getAllPosts().map((p: any) => [p.tweetId, p]));
  return analytics
    .filter((record) => record.result === 'posted' || record.result === 'queued' || record.result === 'dry_run')
    .map((record) => {
      const storagePost: any = storedPosts.get(record.postId);
      const engagement = record.likes + record.reposts * 3 + record.replies * 2;
      const impressions = record.impressions || storagePost?.metrics?.impression_count || 0;
      const clicks = record.clicks || 0;
      return {
        postId: record.postId,
        postedAt: record.postedAt,
        category: record.category,
        textLength: record.text.length,
        mediaType: estimateMediaType(record),
        hasUrl: Boolean(record.url || record.shortUrl || /https?:\/\/\S+/i.test(record.text)),
        genre: inferGenre(`${record.productTitle} ${record.text}`, String(record.templateCategory ?? 'general')),
        appealAxis: inferAppealAxis(record.text),
        impressions,
        engagement,
        engagementRate: impressions > 0 ? Number((engagement / impressions).toFixed(5)) : 0,
        urlClicks: clicks,
        ctr: impressions > 0 ? Number((clicks / impressions).toFixed(5)) : 0,
        conversions: 0,
        revenue: 0,
        textPreview: record.text.slice(0, 120),
        patternTypes: classifyOwnPostPattern(record.text, estimateMediaType(record), Boolean(record.url || record.shortUrl || /https?:\/\/\S+/i.test(record.text))),
      };
    });
}

function average(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function summarizeHours<T>(
  items: T[],
  getTime: (item: T) => string,
  getScore: (item: T) => number,
  scoreKey: 'avgGrowthScore' | 'avgEngagementRate',
): any[] {
  const grouped = new Map<number, number[]>();
  for (const item of items) {
    const hour = jstHour(getTime(item));
    const arr = grouped.get(hour) ?? [];
    arr.push(getScore(item));
    grouped.set(hour, arr);
  }
  return [...grouped.entries()]
    .map(([hour, scores]) => ({ hour, [scoreKey]: Number(average(scores).toFixed(5)), count: scores.length }))
    .sort((a, b) => (b[scoreKey] as number) - (a[scoreKey] as number))
    .slice(0, 6);
}

export function compareMarketWithOwn(marketPosts: RankedMarketPost[], ownPosts: OwnPostComparison[]): MarketComparisonSummary {
  const classifiedMarketPosts = classifyMarketPosts(marketPosts);
  const winningPatterns = summarizeWinningPatterns(classifiedMarketPosts);
  const mediaGroups = new Map<MediaType, number[]>();
  for (const post of marketPosts) {
    const arr = mediaGroups.get(post.media_type) ?? [];
    arr.push(post.growth_score);
    mediaGroups.set(post.media_type, arr);
  }
  const avgOwnEngagementRate = average(ownPosts.map((p) => p.engagementRate));
  const avgMarketEngagementRate = average(marketPosts.map((p) => p.engagement_rate));
  const marketUrlShare = marketPosts.length
    ? marketPosts.filter((p) => p.has_url).length / marketPosts.length
    : 0;
  const ownCtr = average(ownPosts.map((p) => p.ctr));
  const gaps: string[] = [];
  if (marketPosts.length === 0) gaps.push('市場投稿データが不足しています');
  if (ownPosts.filter((p) => p.impressions > 0).length < 3) gaps.push('自分の投稿のimpression実測が不足しています');
  if (ownPosts.every((p) => p.urlClicks === 0)) gaps.push('URLクリック実績が不足しており、収益導線の比較精度が低いです');
  if (ownPosts.every((p) => p.conversions === 0)) gaps.push('conversions/revenueは未連携のため0扱いです。DMM成果レポート連携が必要です');

  const summary: MarketComparisonSummary = {
    ownCount: ownPosts.length,
    competitorCount: marketPosts.length,
    avgOwnEngagementRate: Number(avgOwnEngagementRate.toFixed(5)),
    avgMarketEngagementRate: Number(avgMarketEngagementRate.toFixed(5)),
    avgOwnTextLength: Number(average(ownPosts.map((p) => p.textLength)).toFixed(1)),
    avgMarketTextLength: Number(average(marketPosts.map((p) => p.text.length)).toFixed(1)),
    bestMarketHours: summarizeHours(marketPosts, (p) => p.created_at, (p) => p.growth_score, 'avgGrowthScore'),
    bestOwnHours: summarizeHours(ownPosts, (p) => p.postedAt, (p) => p.engagementRate, 'avgEngagementRate'),
    mediaLift: [...mediaGroups.entries()]
      .map(([mediaType, scores]) => ({ mediaType, avgGrowthScore: Number(average(scores).toFixed(3)), count: scores.length }))
      .sort((a, b) => b.avgGrowthScore - a.avgGrowthScore),
    urlComparison: {
      ownCtr: Number(ownCtr.toFixed(5)),
      marketUrlShare: Number(marketUrlShare.toFixed(5)),
    },
    gaps,
    winningPatterns,
    ownAccountGaps: [],
  };
  const ownAccountGaps = extractOwnAccountGaps(winningPatterns, ownPosts, classifiedMarketPosts, summary);
  summary.ownAccountGaps = ownAccountGaps;
  summary.gaps = [...summary.gaps, ...ownAccountGaps.map((gap) => gap.message)].slice(0, 20);
  return summary;
}

function topItems<T>(items: T[], count: number): T[] {
  return items.slice(0, Math.max(1, count));
}

export function generateProposals(
  input: AgentRunInput,
  marketPosts: RankedMarketPost[],
  ownPosts: OwnPostComparison[],
  comparison: MarketComparisonSummary,
): DraftProposal[] {
  const recentTexts = ownPosts.slice(0, 30).map((p) => p.textPreview);
  const topMarket = topItems(marketPosts, input.proposalCount);
  const bestHour = comparison.bestMarketHours[0]?.hour ?? 20;
  const bestMedia = comparison.mediaLift[0]?.mediaType ?? 'photo';
  const proposals: DraftProposal[] = [];

  for (let idx = 0; idx < input.proposalCount; idx++) {
    const evidence = topMarket[idx % Math.max(topMarket.length, 1)];
    const genre = evidence ? inferGenre(`${evidence.text} ${evidence.hashtags.join(' ')}`, input.genres[idx % input.genres.length] ?? 'レビュー') : input.genres[idx % input.genres.length] ?? 'レビュー';
    const appeal = evidence ? inferAppealAxis(evidence.text) : 'review-proof';
    const cta = '詳細はリプ欄で確認してください👇';
    const hashtags = ['PR'].concat(genre && genre !== 'general' ? [genre] : []).slice(0, 2);
    const draft = [
      `PR・広告｜🔞${genre}系で今日チェックしたい一本`,
      appeal === 'sale'
        ? 'セールやレビューの数字まで見て、今出す理由がある作品だけ選びます。'
        : appeal === 'discovery'
          ? '伸びている投稿は「見つけた」感のある短い導入が強めでした。'
          : 'レビュー数・評価・見せ方の相性を見て候補を絞りました。',
      cta,
    ].join('\n');
    const compliance = runComplianceGuard(draft, {
      isAffiliate: true,
      recentTexts,
      officialMaterialOnly: true,
      mediaRightsConfirmed: true,
    });
    proposals.push({
      id: randomUUID(),
      recommended_work_type: appeal === 'sale' ? 'sale/revenue' : 'high-rated/review',
      recommended_genre: genre,
      draft_text: compliance.normalizedText,
      cta,
      hashtags,
      media_format: bestMedia === 'video' ? 'video' : bestMedia === 'none' ? 'none' : 'image',
      attached_media: {
        format: bestMedia === 'video' ? 'video' : bestMedia === 'none' ? 'none' : 'image',
        source: bestMedia === 'none' ? 'none' : 'official_fanza',
        reason: '市場で伸びている媒体形式に合わせる',
      },
      recommended_post_time_jst: `${String(bestHour).padStart(2, '0')}:00`,
      avoid_patterns: [
        'PR表記なしのアフィリエイト投稿',
        '同一テンプレートの連投',
        '権利確認できない画像/動画の添付',
        ...comparison.gaps.slice(0, 2),
      ],
      reason: evidence
        ? `growth_score=${evidence.growth_score} の市場投稿から、${genre} / ${appeal} / ${evidence.media_type} の型が強いと判断`
        : '市場データ不足のため、既存ジャンルと安全なレビュー訴求を優先',
      confidence: evidence ? Math.min(0.9, 0.45 + evidence.growth_score / 1000) : 0.35,
      expected_effect: '市場で伸びているジャンル/訴求/媒体形式を取り入れ、クリック前の期待値を揃える',
      risk_flags: compliance.risk_flags,
      market_evidence: evidence
        ? [`${evidence.username || evidence.source}: ${evidence.text.slice(0, 120)}`, ...evidence.growth_reason]
        : ['市場投稿データ不足'],
      compliance,
    });
  }

  return proposals;
}

export function diagnoseClaudeFlow(marketCount: number, ownCount: number): ClaudeFlowDiagnostic {
  const issues: ClaudeFlowDiagnostic['issues'] = [
    {
      code: 'analysis_not_injected_into_scheduler_fanza',
      message: 'スケジューラーのFANZA通常投稿はGrok/Claude調査よりテンプレート選択を優先しており、分析結果が本文へ戻りにくいです',
      evidence: 'scheduler.postFanzaItem: researchBuzzForItem実行後にpickFanzaTemplateを使用',
    },
    {
      code: 'weekly_review_not_used_by_generation',
      message: '週次レビューは保存されますが、通常の投稿生成コンテキストへ必ず注入される構造ではありません',
      evidence: 'weekly-review.ts -> scheduler.ts/manualGenerateAndQueue の参照なし',
    },
    {
      code: 'metrics_feedback_sparse',
      message: 'impression/click/conversion/revenueの実測が不足すると、文面改善が成果改善に接続しません',
      evidence: `current run market=${marketCount}, own=${ownCount}`,
    },
    {
      code: 'ui_agent_separate_from_common_api',
      message: 'UIのClaude/AI会議系導線は共通Agent APIではなく個別エンドポイントが混在しており、実行結果の追跡が難しいです',
      evidence: 'meeting routes, Discord tools, dashboard analytics panels are separate flows',
    },
  ];
  if (marketCount < 50) {
    issues.push({
      code: 'competitor_data_insufficient',
      message: '競合/市場投稿データが少なく、分析入力が浅くなる可能性があります',
      evidence: `market posts collected=${marketCount}`,
    });
  }
  if (ownCount < 10) {
    issues.push({
      code: 'own_post_comparison_insufficient',
      message: '自分の投稿実績が少なく、差分比較と勝ちパターン抽出の信頼度が低いです',
      evidence: `own posts compared=${ownCount}`,
    });
  }

  return {
    issues,
    adapterStatus: {
      claudeConfigured: Boolean(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL),
      commonAnalysisService: true,
      adapters: getAnalysisAdapterStatus(),
    },
  };
}

export async function runMarketAnalysis(
  rawInput: Partial<AgentRunInput>,
  source: AgentRun['source'] = 'api',
  kind: AgentRun['kind'] = 'market_scan',
): Promise<AgentRun> {
  const input = normalizeAgentInput(rawInput);
  const run = await startAgentRun(kind, input, source);
  try {
    const market = await scanMarket(input);
    const classifiedMarketPosts = classifyMarketPosts(market.posts);
    const ownPosts = buildOwnPostComparisons(input.ownDays);
    const comparison = compareMarketWithOwn(market.posts, ownPosts);
    const fanzaCandidates = await scoreFanzaWorkCandidates(input, classifiedMarketPosts, comparison.winningPatterns);
    const mediaRecommendations = buildMediaRecommendations(comparison.winningPatterns, fanzaCandidates.works);
    const scheduleRecommendations = buildScheduleRecommendations(comparison);
    const learningSignals = await buildLearningSignals(ownPosts);
    const proposals = generateImprovedDraftProposals(
      input,
      classifiedMarketPosts,
      ownPosts,
      comparison,
      fanzaCandidates.works,
      mediaRecommendations,
      scheduleRecommendations,
    );
    const diagnostics = diagnoseClaudeFlow(market.posts.length, ownPosts.length);
    const riskFlags = [
      ...market.risks,
      ...fanzaCandidates.risks,
      ...comparison.gaps.map((gap) => ({ code: 'comparison_gap', severity: 'warning' as const, message: gap })),
      ...proposals.flatMap((p) => p.risk_flags),
    ];
    const recommendationSchema = buildRecommendationSchema(
      fanzaCandidates.works,
      comparison.winningPatterns,
      comparison.ownAccountGaps,
      proposals,
      mediaRecommendations,
      scheduleRecommendations,
      riskFlags,
      learningSignals,
    );
    const output: AgentRunOutput = {
      marketPosts: market.posts,
      classifiedMarketPosts,
      ownPosts,
      comparison,
      recommendedWorks: fanzaCandidates.works,
      proposals,
      mediaRecommendations,
      scheduleRecommendations,
      learningSignals,
      recommendationSchema,
      diagnostics,
    };
    const costEstimate = Number(((market.posts.length * 0.000002) + 0.001).toFixed(4));
    const completed = await finishAgentRun(run.run_id, {
      output,
      cost_estimate: costEstimate,
      data_count: market.posts.length + ownPosts.length,
      risk_flags: riskFlags,
    }, 'completed');
    return completed ?? run;
  } catch (e: any) {
    const failed = await finishAgentRun(run.run_id, {
      error: e.message ?? String(e),
      risk_flags: [{ code: 'agent_run_failed', severity: 'critical', message: e.message ?? String(e) }],
    }, 'failed');
    return failed ?? run;
  }
}

export { getAgentRun, getAgentRuns };
