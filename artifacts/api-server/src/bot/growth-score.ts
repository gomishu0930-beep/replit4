import type { GrowthScoreConfig, GrowthScoreResult, MarketPost } from './agent-types.js';

export const DEFAULT_GROWTH_SCORE_CONFIG: GrowthScoreConfig = {
  likeWeight: 1,
  repostWeight: 3,
  replyWeight: 2,
  quoteWeight: 2.5,
  bookmarkWeight: 2,
  halfLifeHours: 18,
  followerScale: 1200,
  mediaBoost: {
    none: 1,
    photo: 1.12,
    video: 1.25,
    animated_gif: 1.1,
    mixed: 1.18,
    unknown: 1,
  },
  urlPenalty: 0.9,
  sensitivePenalty: 0.95,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function calculateGrowthScore(
  post: MarketPost,
  config: GrowthScoreConfig = DEFAULT_GROWTH_SCORE_CONFIG,
  now = new Date(),
): GrowthScoreResult {
  const metrics = post.public_metrics ?? {
    like_count: 0,
    retweet_count: 0,
    reply_count: 0,
    quote_count: 0,
    bookmark_count: 0,
  };
  const rawEngagement =
    (metrics.like_count ?? 0) * config.likeWeight +
    (metrics.retweet_count ?? 0) * config.repostWeight +
    (metrics.reply_count ?? 0) * config.replyWeight +
    (metrics.quote_count ?? 0) * config.quoteWeight +
    (metrics.bookmark_count ?? 0) * config.bookmarkWeight;

  const createdAt = new Date(post.created_at).getTime();
  const ageHours = Math.max(0.25, (now.getTime() - createdAt) / 3600000);
  const timeDecay = Math.pow(2, -ageHours / config.halfLifeHours);
  const timeBoost = 1 / Math.max(timeDecay, 0.08);
  const followers = Math.max(0, post.author_followers_count ?? 0);
  const followerNormalizer = Math.sqrt(config.followerScale / Math.max(followers, config.followerScale));
  const impressionBase = metrics.impression_count && metrics.impression_count > 0
    ? metrics.impression_count
    : Math.max(followers * 0.12, 100);
  const engagementRate = rawEngagement / impressionBase;
  const mediaBoost = config.mediaBoost[post.media_type] ?? 1;
  const urlMultiplier = post.has_url ? config.urlPenalty : 1;
  const sensitiveMultiplier = post.possibly_sensitive ? config.sensitivePenalty : 1;
  const score = rawEngagement * timeBoost * followerNormalizer * mediaBoost * urlMultiplier * sensitiveMultiplier;

  const reasons: string[] = [];
  if (rawEngagement >= 50) reasons.push(`反応量が大きい (${Math.round(rawEngagement)})`);
  if (ageHours <= 6 && rawEngagement >= 10) reasons.push(`投稿後${ageHours.toFixed(1)}時間で初速あり`);
  if (followers > 0 && followers < 5000 && rawEngagement >= 10) reasons.push(`小〜中規模アカウント比で反応が強い`);
  if (engagementRate >= 0.03) reasons.push(`推定反応率が高い (${(engagementRate * 100).toFixed(2)}%)`);
  if (post.media_type === 'video') reasons.push('動画付き投稿');
  else if (post.media_type === 'photo' || post.media_type === 'mixed') reasons.push('画像付き投稿');
  if (!post.has_url) reasons.push('URLなしで拡散向き');
  if (post.has_url) reasons.push('URLありの収益導線投稿');
  if (post.possibly_sensitive) reasons.push('sensitive判定あり');
  if (reasons.length === 0) reasons.push('基礎エンゲージメントと経過時間から相対評価');

  return {
    score: Number(clamp(score, 0, 1_000_000).toFixed(3)),
    rawEngagement: Number(rawEngagement.toFixed(3)),
    engagementRate: Number(engagementRate.toFixed(5)),
    ageHours: Number(ageHours.toFixed(2)),
    reasons,
  };
}
