/**
 * post-analytics.ts
 * 投稿ごとの詳細ログ管理 — 17フィールドを保存し、週次AIレビューの入力として使用する。
 */

import { readJson, writeJson } from './cloudStore.js';
import type { TemplateCategory } from './fanza-templates.js';
import type { RebrandlyLink } from './storage.js';

// ─── 型定義 ──────────────────────────────────────────────────────────────────

export interface PostAnalyticsRecord {
  postId: string;            // ツイートID
  postedAt: string;          // ISO8601
  provider: 'twitter';       // 現在はtwitterのみ
  productId: string;         // FANZAのcontent_id（エンゲージ投稿は空文字）
  productTitle: string;      // 作品タイトル（エンゲージ投稿はテーマ）
  category: string;          // postタイプ (fanza/myfans/engagement/erotic-story)
  templateType: string;      // friend-1 / review-3 / etc.
  templateCategory: TemplateCategory | 'engagement' | 'erotic-story' | 'other';
  text: string;              // 投稿テキスト
  url: string;               // アフィリエイトURL（なければ空文字）
  shortUrl: string;          // 短縮URL（Rebrandly）
  linkReplyVariant?: string; // リプ欄リンク文のABテスト識別子
  imageUsed: boolean;        // 画像を使用したか
  safetyScore: number;       // コンテンツフィルタースコア (0-100, 高い=安全)
  result: 'posted' | 'dry_run' | 'failed' | 'queued';
  // メトリクス（後から更新）
  clicks: number;
  impressions: number;
  likes: number;
  reposts: number;
  replies: number;
  metricsUpdatedAt: string | null;
}

interface AnalyticsData {
  records: PostAnalyticsRecord[];
}

// ─── キャッシュ ───────────────────────────────────────────────────────────────

let analyticsCache: AnalyticsData = { records: [] };
let analyticsLoaded = false;
const FANZA_TEMPLATE_CATEGORIES: TemplateCategory[] = ['friend', 'promo', 'sale', 'ranking', 'night', 'review', 'compare'];
const DEFAULT_REVENUE_HOURS = [17, 20, 23];
export const LINK_REPLY_VARIANTS = [
  { id: 'plain', text: '作品ページはこちら\n{url}' },
  { id: 'check', text: '気になる方はこちら👇\n{url}' },
  { id: 'reply', text: 'リプ欄用リンクです👇\n{url}' },
  { id: 'limited', text: '詳細・セール確認はこちら👇\n{url}' },
] as const;

// ─── 永続化 ──────────────────────────────────────────────────────────────────

export async function loadAnalytics(): Promise<void> {
  if (analyticsLoaded) return;
  analyticsCache = await readJson<AnalyticsData>('post-analytics.json', { records: [] });
  analyticsLoaded = true;
}

function saveAnalyticsAsync(): void {
  writeJson('post-analytics.json', analyticsCache).catch((e: any) =>
    console.warn('  ⚠ post-analytics.json 保存失敗:', e.message),
  );
}

// ─── 書き込み ─────────────────────────────────────────────────────────────────

export function recordAnalytics(record: PostAnalyticsRecord): void {
  // 既存レコードが存在する場合は上書き（dry_run→postedへの昇格など）
  const idx = analyticsCache.records.findIndex(r => r.postId === record.postId);
  if (idx >= 0) {
    analyticsCache.records[idx] = record;
  } else {
    analyticsCache.records.push(record);
  }
  saveAnalyticsAsync();
}

export function updateAnalyticsMetrics(
  postId: string,
  metrics: Partial<Pick<PostAnalyticsRecord, 'clicks' | 'impressions' | 'likes' | 'reposts' | 'replies'>>,
): void {
  const record = analyticsCache.records.find(r => r.postId === postId);
  if (!record) return;
  Object.assign(record, metrics, { metricsUpdatedAt: new Date().toISOString() });
  saveAnalyticsAsync();
}

export function updateAnalyticsFromTweetMetrics(postId: string, metrics: any): boolean {
  const record = analyticsCache.records.find(r => r.postId === postId);
  if (!record) return false;
  record.impressions = metrics?.impression_count ?? record.impressions;
  record.likes = metrics?.like_count ?? record.likes;
  record.reposts = metrics?.retweet_count ?? record.reposts;
  record.replies = metrics?.reply_count ?? record.replies;
  record.metricsUpdatedAt = new Date().toISOString();
  saveAnalyticsAsync();
  return true;
}

function linkMatchesRecord(link: RebrandlyLink, record: PostAnalyticsRecord): boolean {
  if (!record.url && !record.shortUrl) return false;
  const short = `rebrand.ly/${link.slashtag}`;
  return (
    record.shortUrl.includes(short) ||
    record.shortUrl.includes(link.slashtag) ||
    record.url === link.destination
  );
}

export function syncAnalyticsClicksFromRebrandly(links: RebrandlyLink[]): number {
  let updated = 0;
  for (const record of analyticsCache.records) {
    const match = links.find((link) => linkMatchesRecord(link, record));
    if (!match) continue;
    if (record.clicks !== match.clicks) {
      record.clicks = match.clicks;
      record.metricsUpdatedAt = new Date().toISOString();
      updated++;
    }
  }
  if (updated > 0) saveAnalyticsAsync();
  return updated;
}

// ─── 読み取り ─────────────────────────────────────────────────────────────────

export function getAnalytics(days = 30): PostAnalyticsRecord[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return analyticsCache.records
    .filter(r => new Date(r.postedAt).getTime() > cutoff)
    .sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());
}

export function getAllAnalytics(): PostAnalyticsRecord[] {
  return [...analyticsCache.records].sort(
    (a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime(),
  );
}

// ─── カテゴリ別パフォーマンス集計 ────────────────────────────────────────────

export function getPerformanceByCategory(days = 7): Record<string, {
  count: number;
  avgImpressions: number;
  avgLikes: number;
  avgReposts: number;
  totalClicks: number;
}> {
  const records = getAnalytics(days).filter(r => r.result === 'posted');
  const byCategory: Record<string, PostAnalyticsRecord[]> = {};
  for (const r of records) {
    if (!byCategory[r.category]) byCategory[r.category] = [];
    byCategory[r.category].push(r);
  }
  const result: Record<string, { count: number; avgImpressions: number; avgLikes: number; avgReposts: number; totalClicks: number }> = {};
  for (const [cat, recs] of Object.entries(byCategory)) {
    const n = recs.length;
    result[cat] = {
      count: n,
      avgImpressions: n > 0 ? Math.round(recs.reduce((s, r) => s + r.impressions, 0) / n) : 0,
      avgLikes:       n > 0 ? Math.round(recs.reduce((s, r) => s + r.likes, 0) / n) : 0,
      avgReposts:     n > 0 ? Math.round(recs.reduce((s, r) => s + r.reposts, 0) / n) : 0,
      totalClicks:    recs.reduce((s, r) => s + r.clicks, 0),
    };
  }
  return result;
}

export function getAnalyticsStats(days = 7): {
  total: number;
  posted: number;
  dryRun: number;
  failed: number;
  avgImpressions: number;
  avgLikes: number;
  totalClicks: number;
  ctrPct: number;
  topCategory: string;
  topTemplateCategory: string;
} {
  const records = getAnalytics(days);
  const posted = records.filter(r => r.result === 'posted');
  const dryRun = records.filter(r => r.result === 'dry_run');
  const failed = records.filter(r => r.result === 'failed');

  const avgImpressions = posted.length > 0
    ? Math.round(posted.reduce((s, r) => s + r.impressions, 0) / posted.length)
    : 0;
  const avgLikes = posted.length > 0
    ? Math.round(posted.reduce((s, r) => s + r.likes, 0) / posted.length)
    : 0;
  const totalClicks = posted.reduce((s, r) => s + r.clicks, 0);
  const totalImpressions = posted.reduce((s, r) => s + r.impressions, 0);
  const ctrPct = totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(3)) : 0;

  const categoryCounts = records.reduce<Record<string, number>>((acc, r) => {
    acc[r.category] = (acc[r.category] ?? 0) + 1;
    return acc;
  }, {});
  const topCategory = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none';

  const tmplCategoryCounts = records.reduce<Record<string, number>>((acc, r) => {
    const k = String(r.templateCategory);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const topTemplateCategory = Object.entries(tmplCategoryCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none';

  return {
    total: records.length,
    posted: posted.length,
    dryRun: dryRun.length,
    failed: failed.length,
    avgImpressions,
    avgLikes,
    totalClicks,
    ctrPct,
    topCategory,
    topTemplateCategory,
  };
}

export function getTemplatePerformance(days = 30): Array<{
  templateCategory: string;
  count: number;
  totalClicks: number;
  totalImpressions: number;
  avgClicks: number;
  ctrPct: number;
  verdict: 'win' | 'neutral' | 'loss';
}> {
  const records = getAnalytics(days).filter(r => r.result === 'posted');
  const totalClicks = records.reduce((s, r) => s + r.clicks, 0);
  const totalImpressions = records.reduce((s, r) => s + r.impressions, 0);
  const baselineCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const grouped: Record<string, PostAnalyticsRecord[]> = {};
  for (const r of records) {
    const key = String(r.templateCategory || 'other');
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  }
  return Object.entries(grouped)
    .map(([templateCategory, recs]) => {
      const totalClicks = recs.reduce((s, r) => s + r.clicks, 0);
      const totalImpressions = recs.reduce((s, r) => s + r.impressions, 0);
      const ctrPct = totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(3)) : 0;
      let verdict: 'win' | 'neutral' | 'loss' = 'neutral';
      if (recs.length >= 3 && baselineCtr > 0) {
        if (ctrPct >= baselineCtr * 1.2) verdict = 'win';
        else if (ctrPct <= baselineCtr * 0.75) verdict = 'loss';
      }
      return {
        templateCategory,
        count: recs.length,
        totalClicks,
        totalImpressions,
        avgClicks: recs.length > 0 ? Number((totalClicks / recs.length).toFixed(2)) : 0,
        ctrPct,
        verdict,
      };
    })
    .sort((a, b) => b.totalClicks - a.totalClicks || b.ctrPct - a.ctrPct);
}

export function getPostingHourPerformance(days = 30): Array<{
  hour: number;
  count: number;
  totalClicks: number;
  totalImpressions: number;
  ctrPct: number;
  score: number;
}> {
  const grouped = new Map<number, PostAnalyticsRecord[]>();
  for (const r of getAnalytics(days).filter(r => r.result === 'posted' && r.category === 'fanza')) {
    const hour = (new Date(r.postedAt).getUTCHours() + 9) % 24;
    grouped.set(hour, [...(grouped.get(hour) ?? []), r]);
  }
  return [...grouped.entries()]
    .map(([hour, recs]) => {
      const totalClicks = recs.reduce((s, r) => s + r.clicks, 0);
      const totalImpressions = recs.reduce((s, r) => s + r.impressions, 0);
      const ctrPct = totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(3)) : 0;
      return {
        hour,
        count: recs.length,
        totalClicks,
        totalImpressions,
        ctrPct,
        score: Number((totalClicks + ctrPct * 2 + Math.min(recs.length, 5) * 0.2).toFixed(3)),
      };
    })
    .sort((a, b) => b.score - a.score || b.totalClicks - a.totalClicks);
}

export function isHighRevenueHour(date = new Date()): boolean {
  const hours = getRecommendedRevenueHours(30);
  const jstHour = (date.getUTCHours() + 9) % 24;
  return hours.includes(jstHour);
}

export function getRecommendedRevenueHours(days = 30): number[] {
  const learned = getPostingHourPerformance(days)
    .filter(h => h.count >= 2)
    .slice(0, 3)
    .map(h => h.hour);
  return learned.length > 0 ? learned : DEFAULT_REVENUE_HOURS;
}

export function getNextRecommendedRevenueHour(date = new Date(), days = 30): number {
  const jstHour = (date.getUTCHours() + 9) % 24;
  const hours = [...getRecommendedRevenueHours(days)].sort((a, b) => a - b);
  return hours.find(hour => hour > jstHour) ?? hours[0] ?? DEFAULT_REVENUE_HOURS[0];
}

export function getLinkReplyPerformance(days = 30): Array<{
  variant: string;
  count: number;
  totalClicks: number;
  avgClicks: number;
}> {
  const grouped = new Map<string, PostAnalyticsRecord[]>();
  for (const r of getAnalytics(days).filter(r => r.result === 'posted' && r.shortUrl)) {
    const variant = r.linkReplyVariant ?? 'plain';
    grouped.set(variant, [...(grouped.get(variant) ?? []), r]);
  }
  return [...grouped.entries()]
    .map(([variant, recs]) => {
      const totalClicks = recs.reduce((s, r) => s + r.clicks, 0);
      return {
        variant,
        count: recs.length,
        totalClicks,
        avgClicks: recs.length > 0 ? Number((totalClicks / recs.length).toFixed(2)) : 0,
      };
    })
    .sort((a, b) => b.avgClicks - a.avgClicks || b.totalClicks - a.totalClicks);
}

export function pickAffiliateReplyCopy(url: string): { text: string; variant: string } {
  const performance = getLinkReplyPerformance(30).filter(p => p.count >= 3);
  const winner = performance[0];
  const explore = Math.random() < 0.35 || !winner;
  const variant = explore
    ? LINK_REPLY_VARIANTS[Math.floor(Math.random() * LINK_REPLY_VARIANTS.length)]
    : LINK_REPLY_VARIANTS.find(v => v.id === winner.variant) ?? LINK_REPLY_VARIANTS[0];
  return { text: variant.text.replace('{url}', url), variant: variant.id };
}

export function getTemplateCategoryWeights(days = 30): Record<TemplateCategory, number> {
  const performance = getTemplatePerformance(days);
  const weights = FANZA_TEMPLATE_CATEGORIES.reduce<Record<TemplateCategory, number>>((acc, category) => {
    acc[category] = 1;
    return acc;
  }, {} as Record<TemplateCategory, number>);

  for (const p of performance) {
    if (!FANZA_TEMPLATE_CATEGORIES.includes(p.templateCategory as TemplateCategory)) continue;
    const category = p.templateCategory as TemplateCategory;
    const sampleConfidence = Math.min(p.count / 8, 1);
    const clickScore = Math.min(p.avgClicks / 3, 1.5);
    const ctrScore = Math.min(p.ctrPct / 1.5, 1.5);
    const rawWeight = 1 + sampleConfidence * (clickScore * 0.7 + ctrScore * 0.5);
    weights[category] = Number(Math.min(Math.max(rawWeight, 0.7), 3).toFixed(2));
  }

  return weights;
}

export function getProductClickSignals(): Record<string, number> {
  const signals: Record<string, number> = {};
  for (const r of analyticsCache.records) {
    if (!r.productId || r.result !== 'posted') continue;
    signals[r.productId] = Math.max(signals[r.productId] ?? 0, r.clicks);
  }
  return signals;
}

export function getClickedProductSignals(limit = 80): Array<{ productId: string; productTitle: string; clicks: number; impressions: number }> {
  return analyticsCache.records
    .filter(r => r.result === 'posted' && r.category === 'fanza' && r.clicks > 0)
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, limit)
    .map(r => ({
      productId: r.productId,
      productTitle: r.productTitle,
      clicks: r.clicks,
      impressions: r.impressions,
    }));
}

export function getRevenueSummary(days = 30): {
  stats: ReturnType<typeof getAnalyticsStats>;
  topProducts: PostAnalyticsRecord[];
  topTemplates: ReturnType<typeof getTemplatePerformance>;
  templateVerdicts: ReturnType<typeof getTemplatePerformance>;
  bestHours: ReturnType<typeof getPostingHourPerformance>;
  recommendedHours: number[];
  nextRecommendedHour: number;
  linkReplyTests: ReturnType<typeof getLinkReplyPerformance>;
  zeroClickPosts: PostAnalyticsRecord[];
  zeroClickAnalysis: {
    total: number;
    byTemplate: Array<{ templateCategory: string; count: number; avgImpressions: number }>;
    byHour: Array<{ hour: number; count: number; avgImpressions: number }>;
  };
} {
  const records = getAnalytics(days).filter(r => r.result === 'posted');
  const zeroClickPosts = records
    .filter(r => r.shortUrl && r.clicks === 0)
    .sort((a, b) => b.impressions - a.impressions);

  const groupZeroClicks = <T extends string | number>(keyFn: (r: PostAnalyticsRecord) => T) => {
    const grouped = new Map<T, PostAnalyticsRecord[]>();
    for (const r of zeroClickPosts) {
      const key = keyFn(r);
      grouped.set(key, [...(grouped.get(key) ?? []), r]);
    }
    return [...grouped.entries()]
      .map(([key, recs]) => ({
        key,
        count: recs.length,
        avgImpressions: recs.length > 0 ? Math.round(recs.reduce((s, r) => s + r.impressions, 0) / recs.length) : 0,
      }))
      .sort((a, b) => b.count - a.count || b.avgImpressions - a.avgImpressions);
  };

  return {
    stats: getAnalyticsStats(days),
    topProducts: records
      .filter(r => r.productId || r.productTitle)
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
      .slice(0, 10),
    topTemplates: getTemplatePerformance(days).slice(0, 10),
    templateVerdicts: getTemplatePerformance(days),
    bestHours: getPostingHourPerformance(days).slice(0, 6),
    recommendedHours: getRecommendedRevenueHours(days),
    nextRecommendedHour: getNextRecommendedRevenueHour(new Date(), days),
    linkReplyTests: getLinkReplyPerformance(days).slice(0, 6),
    zeroClickPosts: zeroClickPosts.slice(0, 10),
    zeroClickAnalysis: {
      total: zeroClickPosts.length,
      byTemplate: groupZeroClicks(r => String(r.templateCategory || 'other'))
        .slice(0, 6)
        .map(g => ({ templateCategory: String(g.key), count: g.count, avgImpressions: g.avgImpressions })),
      byHour: groupZeroClicks(r => (new Date(r.postedAt).getUTCHours() + 9) % 24)
        .slice(0, 6)
        .map(g => ({ hour: Number(g.key), count: g.count, avgImpressions: g.avgImpressions })),
    },
  };
}
