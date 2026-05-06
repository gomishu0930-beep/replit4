import { readJson, writeJson } from './cloudStore.js';

export interface RevenueReportRow {
  id: string;
  imported_at: string;
  occurred_at?: string;
  post_id?: string;
  product_id?: string;
  content_id?: string;
  title?: string;
  clicks: number;
  conversions: number;
  revenue: number;
  commission?: number;
  source: string;
  raw: Record<string, unknown>;
}

interface RevenueReportData {
  rows: RevenueReportRow[];
}

const KEY = 'revenue-report.json';
let cache: RevenueReportData = { rows: [] };
let loaded = false;

function valueOf(raw: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') return raw[key];
  }
  return undefined;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value ?? '')
    .replace(/[¥￥,\s]/g, '')
    .replace(/円$/, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toStringValue(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function normalizeRevenueRow(rawInput: unknown, source: string): RevenueReportRow {
  const raw = (rawInput && typeof rawInput === 'object' ? rawInput : { value: rawInput }) as Record<string, unknown>;
  const postId = toStringValue(valueOf(raw, ['post_id', 'postId', 'tweet_id', 'tweetId', '投稿ID', 'ツイートID']));
  const productId = toStringValue(valueOf(raw, ['product_id', 'productId', '商品ID', '品番', '品番/商品ID']));
  const contentId = toStringValue(valueOf(raw, ['content_id', 'contentId', 'コンテンツID', 'contentId']));
  const occurredAt = toStringValue(valueOf(raw, ['occurred_at', 'occurredAt', 'date', '発生日', '成果発生日', '注文日']));
  const conversions = toNumber(valueOf(raw, ['conversions', 'conversion', 'cv', 'CV', '成果', '成果件数', '件数'])) || (toNumber(valueOf(raw, ['revenue', '売上', '報酬', 'commission'])) > 0 ? 1 : 0);
  const revenue = toNumber(valueOf(raw, ['revenue', 'sales', '売上', '売上金額', '成果金額']));
  const commission = toNumber(valueOf(raw, ['commission', 'reward', '報酬', '報酬額', 'アフィリエイト報酬']));
  const clicks = toNumber(valueOf(raw, ['clicks', 'クリック', 'クリック数']));
  return {
    id: [
      source,
      postId ?? productId ?? contentId ?? 'unknown',
      occurredAt ?? new Date().toISOString(),
      Math.abs(JSON.stringify(raw).split('').reduce((s, c) => ((s << 5) - s + c.charCodeAt(0)) | 0, 0)),
    ].join(':'),
    imported_at: new Date().toISOString(),
    occurred_at: occurredAt,
    post_id: postId,
    product_id: productId,
    content_id: contentId,
    title: toStringValue(valueOf(raw, ['title', 'product_title', '商品名', '作品名'])),
    clicks,
    conversions,
    revenue,
    commission,
    source,
    raw,
  };
}

export async function loadRevenueReports(): Promise<RevenueReportData> {
  if (!loaded) {
    cache = await readJson<RevenueReportData>(KEY, { rows: [] });
    loaded = true;
  }
  return cache;
}

async function saveRevenueReports(): Promise<void> {
  cache.rows = cache.rows.slice(0, 5000);
  await writeJson(KEY, cache);
}

export async function importRevenueReportRows(rows: unknown[], source = 'manual'): Promise<{ imported: number; total: number; rows: RevenueReportRow[] }> {
  await loadRevenueReports();
  const normalized = rows.map((row) => normalizeRevenueRow(row, source));
  const byId = new Map(cache.rows.map((row) => [row.id, row]));
  let imported = 0;
  for (const row of normalized) {
    if (!byId.has(row.id)) imported++;
    byId.set(row.id, row);
  }
  cache.rows = [...byId.values()].sort((a, b) => (b.occurred_at ?? b.imported_at).localeCompare(a.occurred_at ?? a.imported_at));
  await saveRevenueReports();
  return { imported, total: cache.rows.length, rows: normalized };
}

export function getRevenueSignalsByPostId(): Record<string, { conversions: number; revenue: number; clicks: number }> {
  const signals: Record<string, { conversions: number; revenue: number; clicks: number }> = {};
  const add = (key: string | undefined, row: RevenueReportRow) => {
    if (!key) return;
    const current = signals[key] ?? { conversions: 0, revenue: 0, clicks: 0 };
    current.conversions += row.conversions;
    current.revenue += row.revenue || row.commission || 0;
    current.clicks += row.clicks;
    signals[key] = current;
  };
  for (const row of cache.rows) {
    add(row.post_id, row);
    add(row.product_id, row);
    add(row.content_id, row);
  }
  return signals;
}

export function getRevenueWeightSignals(): {
  sampleSize: number;
  totalConversions: number;
  totalRevenue: number;
  byProduct: Array<{ id: string; conversions: number; revenue: number; clicks: number }>;
  byPost: Array<{ id: string; conversions: number; revenue: number; clicks: number }>;
} {
  const byProduct = new Map<string, { conversions: number; revenue: number; clicks: number }>();
  const byPost = new Map<string, { conversions: number; revenue: number; clicks: number }>();
  const add = (map: Map<string, { conversions: number; revenue: number; clicks: number }>, key: string | undefined, row: RevenueReportRow) => {
    if (!key) return;
    const current = map.get(key) ?? { conversions: 0, revenue: 0, clicks: 0 };
    current.conversions += row.conversions;
    current.revenue += row.revenue || row.commission || 0;
    current.clicks += row.clicks;
    map.set(key, current);
  };
  for (const row of cache.rows) {
    add(byProduct, row.product_id ?? row.content_id, row);
    add(byPost, row.post_id, row);
  }
  const ranked = (map: Map<string, { conversions: number; revenue: number; clicks: number }>) => [...map.entries()]
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => b.revenue - a.revenue || b.conversions - a.conversions)
    .slice(0, 50);
  return {
    sampleSize: cache.rows.length,
    totalConversions: cache.rows.reduce((sum, row) => sum + row.conversions, 0),
    totalRevenue: cache.rows.reduce((sum, row) => sum + (row.revenue || row.commission || 0), 0),
    byProduct: ranked(byProduct),
    byPost: ranked(byPost),
  };
}
