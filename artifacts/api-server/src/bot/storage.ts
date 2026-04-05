/**
 * storage.ts — 投稿データ / 外部パターンの永続管理
 *
 * - 起動時に GCS から読み込み → インメモリキャッシュで高速アクセス
 * - 書き込みは ローカルファイル（即時）+ GCS（非同期）の二重保存
 * - GCS が使えない環境ではローカルファイルのみで動作（フォールバック）
 */
import { readJson, writeJson } from './cloudStore.js';

// ─── 型定義 ──────────────────────────────────────────────────────────────────

interface PostMetrics {
  like_count: number;
  retweet_count: number;
  reply_count?: number;
  bookmark_count?: number;
  checkedAt: string;
}

interface PostRecord {
  tweetId: string;
  replyId: string;
  type: string;
  contentType?: string;  // 5型分類: レビュー型/比較型/ランキング型/失敗回避型/共感型
  text: string;
  item: { id: string; title: string; affiliateURL: string };
  postedAt: string;
  metrics: PostMetrics | null;
}

interface PostsData {
  posts: PostRecord[];
}

export interface ExternalPattern {
  tweetId: string;
  text: string;
  authorId: string;
  like_count: number;
  retweet_count: number;
  reply_count: number;
  bookmark_count: number;
  impression_count: number;
  score: number;
  source: string;
  savedAt: string;
}

interface ExternalPatternsData {
  patterns: ExternalPattern[];
  lastRefreshedAt: string | null;
  queries: string[];
}

// ─── 動的テンプレート型 ───────────────────────────────────────────────────────

export interface DynamicTemplate {
  text: string;             // テンプレート文字列（{actress}等のプレースホルダーあり）
  type: string;             // 対応スロット種別（amateur/rank/sale/buzz/random/any）
  sourceScore: number;      // 生成元外部パターンの平均スコア
  generatedAt: string;
  usedCount: number;        // 実際に使われた回数
}

interface DynamicTemplatesData {
  templates: DynamicTemplate[];
  lastEvolvedAt: string | null;
  evolutionCount: number;
}

// ─── インメモリキャッシュ ─────────────────────────────────────────────────────

let postsCache: PostsData = { posts: [] };
let extCache: ExternalPatternsData = { patterns: [], lastRefreshedAt: null, queries: [] };
let dynTemplatesCache: DynamicTemplatesData = { templates: [], lastEvolvedAt: null, evolutionCount: 0 };
let initialized = false;

// ─── 初期化（起動時に1回だけ呼ぶ）───────────────────────────────────────────

export async function initStorage(): Promise<void> {
  if (initialized) return;
  console.log('  📦 ストレージ初期化: GCSからデータを読み込み中...');
  postsCache    = await readJson<PostsData>('posts.json', { posts: [] });
  extCache      = await readJson<ExternalPatternsData>('external-patterns.json', {
    patterns: [], lastRefreshedAt: null, queries: [],
  });
  dynTemplatesCache = await readJson<DynamicTemplatesData>('dynamic-templates.json', {
    templates: [], lastEvolvedAt: null, evolutionCount: 0,
  });
  initialized = true;
  console.log(
    `  ✅ ストレージ初期化完了 (投稿: ${postsCache.posts.length}件 / 外部パターン: ${extCache.patterns.length}件 / 動的テンプレート: ${dynTemplatesCache.templates.length}件)`,
  );
}

// ─── Posts ────────────────────────────────────────────────────────────────────

function savePostsAsync() {
  writeJson('posts.json', postsCache).catch((e: any) =>
    console.warn('  ⚠ posts.json 保存失敗:', e.message),
  );
}

export function recordPost({ tweetId, replyId, item, text, type, contentType }: {
  tweetId: string; replyId: string; item: any; text: string; type: string; contentType?: string;
}) {
  postsCache.posts.push({
    tweetId, replyId, type, contentType, text,
    item: { id: item.content_id, title: item.title, affiliateURL: item.affiliateURL },
    postedAt: new Date().toISOString(),
    metrics: null,
  });
  savePostsAsync();
}

export function getRecentlyPostedIds(days = 30): Set<string> {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const ids = new Set<string>();
  for (const p of postsCache.posts) {
    if (new Date(p.postedAt).getTime() > cutoff && p.item?.id) {
      ids.add(p.item.id);
    }
  }
  return ids;
}

export function updateMetrics(tweetId: string, metrics: any) {
  const post = postsCache.posts.find((p) => p.tweetId === tweetId);
  if (post) {
    post.metrics = { ...metrics, checkedAt: new Date().toISOString() };
    savePostsAsync();
  }
}

export function getTopPatterns(limit = 10): PostRecord[] {
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const withMetrics = postsCache.posts.filter(
    (p) => p.metrics && new Date(p.postedAt).getTime() > oneWeekAgo,
  );
  withMetrics.sort((a, b) => {
    const score = (m: PostMetrics) =>
      (m.like_count || 0) + (m.retweet_count || 0) * 3 +
      (m.bookmark_count || 0) * 2 + (m.reply_count || 0);
    return score(b.metrics!) - score(a.metrics!);
  });
  return withMetrics.slice(0, limit);
}

export function getRecentPostIds(days = 7): string[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return postsCache.posts
    .filter((p) => p.tweetId && new Date(p.postedAt).getTime() > cutoff)
    .map((p) => p.tweetId);
}

export function getAllPosts(): PostRecord[] {
  return postsCache.posts;
}

export function getPostsAfter(since: Date): PostRecord[] {
  return postsCache.posts.filter((p) => new Date(p.postedAt) >= since);
}

export function getStats() {
  const posts = postsCache.posts;
  const last7 = posts.filter(
    (p) => new Date(p.postedAt).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000,
  );
  const lastPost = posts.length > 0 ? posts[posts.length - 1] : null;
  const withMetrics = posts.filter((p) => p.metrics);
  const totalLikes = withMetrics.reduce((sum, p) => sum + (p.metrics?.like_count || 0), 0);
  const totalRTs = withMetrics.reduce((sum, p) => sum + (p.metrics?.retweet_count || 0), 0);
  return {
    totalPosts: posts.length,
    postsLast7Days: last7.length,
    lastPostedAt: lastPost?.postedAt ?? null,
    lastPostTitle: lastPost?.item?.title ?? null,
    totalLikes,
    totalRetweets: totalRTs,
  };
}

// ─── External Patterns ────────────────────────────────────────────────────────

function saveExtAsync() {
  writeJson('external-patterns.json', extCache).catch((e: any) =>
    console.warn('  ⚠ external-patterns.json 保存失敗:', e.message),
  );
}

export function upsertExternalPatterns(
  incoming: Omit<ExternalPattern, 'savedAt'>[],
  source: string,
) {
  const existingIds = new Set(extCache.patterns.map((p) => p.tweetId));
  let added = 0;
  for (const p of incoming) {
    if (!existingIds.has(p.tweetId)) {
      extCache.patterns.push({ ...p, source, savedAt: new Date().toISOString() });
      added++;
    } else {
      const existing = extCache.patterns.find((e) => e.tweetId === p.tweetId);
      if (existing) {
        existing.like_count = p.like_count;
        existing.retweet_count = p.retweet_count;
        existing.bookmark_count = p.bookmark_count;
        existing.impression_count = p.impression_count;
        existing.score = p.score;
      }
    }
  }
  extCache.patterns.sort((a, b) => b.score - a.score);
  extCache.patterns = extCache.patterns.slice(0, 100);
  extCache.lastRefreshedAt = new Date().toISOString();
  if (source && !extCache.queries.includes(source)) extCache.queries.push(source);
  saveExtAsync();
  return added;
}

export function getExternalTopPatterns(limit = 10): ExternalPattern[] {
  return extCache.patterns.slice(0, limit);
}

// ─── Dynamic Templates ────────────────────────────────────────────────────────

function saveDynTemplatesAsync() {
  writeJson('dynamic-templates.json', dynTemplatesCache).catch((e: any) =>
    console.warn('  ⚠ dynamic-templates.json 保存失敗:', e.message),
  );
}

export function upsertDynamicTemplates(newTemplates: Omit<DynamicTemplate, 'usedCount'>[]) {
  for (const t of newTemplates) {
    dynTemplatesCache.templates.push({ ...t, usedCount: 0 });
  }
  // 最新100件に絞る（使用回数が多いものを優先残留）
  dynTemplatesCache.templates.sort((a, b) => b.sourceScore - a.sourceScore);
  dynTemplatesCache.templates = dynTemplatesCache.templates.slice(0, 100);
  dynTemplatesCache.lastEvolvedAt = now;
  dynTemplatesCache.evolutionCount++;
  saveDynTemplatesAsync();
}

export function getDynamicTemplates(type?: string, limit = 5): DynamicTemplate[] {
  const pool = type
    ? dynTemplatesCache.templates.filter((t) => t.type === type || t.type === 'any')
    : dynTemplatesCache.templates;
  // 使用回数が少ないものを優先（まんべんなく使う）
  return [...pool].sort((a, b) => a.usedCount - b.usedCount).slice(0, limit);
}

export function recordDynamicTemplateUsed(text: string) {
  const t = dynTemplatesCache.templates.find((t) => t.text === text);
  if (t) {
    t.usedCount++;
    saveDynTemplatesAsync();
  }
}

export function getDynamicTemplatesInfo() {
  return {
    count: dynTemplatesCache.templates.length,
    lastEvolvedAt: dynTemplatesCache.lastEvolvedAt,
    evolutionCount: dynTemplatesCache.evolutionCount,
    topTemplates: dynTemplatesCache.templates.slice(0, 5).map((t) => ({
      type: t.type,
      preview: t.text.slice(0, 40),
      usedCount: t.usedCount,
      sourceScore: t.sourceScore,
    })),
  };
}

export function getExternalPatternsInfo() {
  return {
    count: extCache.patterns.length,
    lastRefreshedAt: extCache.lastRefreshedAt,
    queries: extCache.queries,
    topPatterns: extCache.patterns.slice(0, 10),
  };
}
