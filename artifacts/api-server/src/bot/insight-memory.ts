/**
 * insight-memory.ts — 分析インサイト永続化ストア
 *
 * ①自分の投稿分析 / ②外部トレンド分析 / ③競合パターン / ④メディアパターン
 * の結果を永続化し、投稿生成時に参照する。
 */

import { readJson, writeJson } from './cloudStore.js';

// ─── 型定義 ──────────────────────────────────────────────────────────────────

export interface InsightRecord {
  id: string;
  savedAt: string;
  category: 'own-post' | 'trending' | 'competitor' | 'media' | 'strategy';
  title: string;
  content: string;
  tags: string[];
  score: number;       // 0-100 重要度（高いほど生成に優先反映）
  usedCount: number;   // 生成に使われた回数
  source?: string;     // 参照元（アカウント名・クエリ等）
}

interface InsightData {
  insights: InsightRecord[];
  lastUpdatedAt: string | null;
}

// ─── キャッシュ ───────────────────────────────────────────────────────────────

let cache: InsightData = { insights: [], lastUpdatedAt: null };
let loaded = false;

// ─── 永続化 ──────────────────────────────────────────────────────────────────

export async function loadInsightMemory(): Promise<void> {
  if (loaded) return;
  cache = await readJson<InsightData>('insight-memory.json', { insights: [], lastUpdatedAt: null });
  loaded = true;
}

function saveAsync(): void {
  writeJson('insight-memory.json', cache).catch((e: any) =>
    console.warn('  ⚠ insight-memory.json 保存失敗:', e.message),
  );
}

// ─── 書き込み ─────────────────────────────────────────────────────────────────

export function saveInsight(
  category: InsightRecord['category'],
  title: string,
  content: string,
  tags: string[] = [],
  score = 50,
  source?: string,
): InsightRecord {
  const id = `ins_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const record: InsightRecord = {
    id,
    savedAt: new Date().toISOString(),
    category,
    title,
    content,
    tags,
    score,
    usedCount: 0,
    source,
  };
  cache.insights.unshift(record);
  if (cache.insights.length > 300) cache.insights = cache.insights.slice(0, 300);
  cache.lastUpdatedAt = new Date().toISOString();
  saveAsync();
  return record;
}

export function getInsights(
  category?: InsightRecord['category'],
  limit = 20,
): InsightRecord[] {
  let items = cache.insights;
  if (category) items = items.filter(i => i.category === category);
  return items
    .sort((a, b) => b.score - a.score || new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
    .slice(0, limit);
}

export function getInsightById(id: string): InsightRecord | undefined {
  return cache.insights.find(i => i.id === id);
}

export function deleteInsight(id: string): boolean {
  const idx = cache.insights.findIndex(i => i.id === id);
  if (idx < 0) return false;
  cache.insights.splice(idx, 1);
  saveAsync();
  return true;
}

export function incrementInsightUsed(id: string): void {
  const item = cache.insights.find(i => i.id === id);
  if (item) { item.usedCount++; saveAsync(); }
}

// ─── 生成プロンプト用サマリー ─────────────────────────────────────────────────

export function buildInsightContext(limit = 8): string {
  const items = getInsights(undefined, limit);
  if (items.length === 0) return '';
  return items
    .map(i => `[${i.category}] ${i.title}: ${i.content}`)
    .join('\n');
}

// ─── サマリー ─────────────────────────────────────────────────────────────────

export function getInsightSummary(): {
  total: number;
  byCategory: Record<string, number>;
  lastUpdatedAt: string | null;
} {
  const byCategory: Record<string, number> = {};
  for (const i of cache.insights) {
    byCategory[i.category] = (byCategory[i.category] ?? 0) + 1;
  }
  return { total: cache.insights.length, byCategory, lastUpdatedAt: cache.lastUpdatedAt };
}
