/**
 * post-analytics.ts
 * 投稿ごとの詳細ログ管理 — 17フィールドを保存し、週次AIレビューの入力として使用する。
 */

import { readJson, writeJson } from './cloudStore.js';
import type { TemplateCategory } from './fanza-templates.js';

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
    topCategory,
    topTemplateCategory,
  };
}
