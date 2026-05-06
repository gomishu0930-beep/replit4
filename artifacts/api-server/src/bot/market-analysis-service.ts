import type { MarketComparisonSummary, MediaType, OwnPostComparison, RankedMarketPost } from './agent-types.js';
import { classifyMarketPosts, extractOwnAccountGaps, summarizeWinningPatterns } from './posting-improvement.js';

function average(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function jstHour(iso: string): number {
  const d = new Date(iso);
  return (d.getUTCHours() + 9) % 24;
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
  if (ownPosts.every((p) => p.conversions === 0)) gaps.push('conversions/revenueは未連携または不足しており、DMM成果レポート連携の蓄積が必要です');

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
