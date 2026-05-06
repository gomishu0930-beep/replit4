import type { MediaType, OwnPostComparison } from './agent-types.js';
import { getAnalytics } from './post-analytics.js';
import { getAllPosts } from './storage.js';
import { classifyOwnPostPattern } from './posting-improvement.js';
import { getRevenueSignalsByPostId } from './revenue-report-store.js';

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

function estimateMediaType(record: { imageUsed?: boolean }): MediaType {
  return record.imageUsed ? 'photo' : 'none';
}

export function buildOwnPostComparisons(days: number): OwnPostComparison[] {
  const analytics = getAnalytics(days);
  const storedPosts = new Map(getAllPosts().map((p: any) => [p.tweetId, p]));
  const revenueByPost = getRevenueSignalsByPostId();
  return analytics
    .filter((record) => record.result === 'posted' || record.result === 'queued' || record.result === 'dry_run')
    .map((record) => {
      const storagePost: any = storedPosts.get(record.postId);
      const engagement = record.likes + record.reposts * 3 + record.replies * 2;
      const impressions = record.impressions || storagePost?.metrics?.impression_count || 0;
      const clicks = record.clicks || 0;
      const mediaType = estimateMediaType(record);
      const revenueSignal = revenueByPost[record.postId] ?? (record.productId ? revenueByPost[record.productId] : undefined);
      return {
        postId: record.postId,
        postedAt: record.postedAt,
        category: record.category,
        textLength: record.text.length,
        mediaType,
        hasUrl: Boolean(record.url || record.shortUrl || /https?:\/\/\S+/i.test(record.text)),
        genre: inferGenre(`${record.productTitle} ${record.text}`, String(record.templateCategory ?? 'general')),
        appealAxis: inferAppealAxis(record.text),
        impressions,
        engagement,
        engagementRate: impressions > 0 ? Number((engagement / impressions).toFixed(5)) : 0,
        urlClicks: clicks,
        ctr: impressions > 0 ? Number((clicks / impressions).toFixed(5)) : 0,
        conversions: revenueSignal?.conversions ?? 0,
        revenue: revenueSignal?.revenue ?? 0,
        textPreview: record.text.slice(0, 120),
        patternTypes: classifyOwnPostPattern(record.text, mediaType, Boolean(record.url || record.shortUrl || /https?:\/\/\S+/i.test(record.text))),
      };
    });
}
