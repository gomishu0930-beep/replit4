import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const DATA_DIR = resolve(process.cwd(), 'fanza-bot/data');
const DB_FILE = resolve(DATA_DIR, 'posts.json');
const EXT_FILE = resolve(DATA_DIR, 'external-patterns.json');

function ensureDir() {
  mkdirSync(DATA_DIR, { recursive: true });
}

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
  text: string;
  item: { id: string; title: string; affiliateURL: string };
  postedAt: string;
  metrics: PostMetrics | null;
}

interface PostsData {
  posts: PostRecord[];
}

export function loadData(): PostsData {
  ensureDir();
  if (!existsSync(DB_FILE)) return { posts: [] };
  try {
    return JSON.parse(readFileSync(DB_FILE, 'utf-8')) as PostsData;
  } catch {
    return { posts: [] };
  }
}

export function saveData(data: PostsData) {
  ensureDir();
  writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function recordPost({ tweetId, replyId, item, text, type }: {
  tweetId: string; replyId: string; item: any; text: string; type: string;
}) {
  const data = loadData();
  data.posts.push({
    tweetId, replyId, type, text,
    item: { id: item.content_id, title: item.title, affiliateURL: item.affiliateURL },
    postedAt: new Date().toISOString(),
    metrics: null,
  });
  saveData(data);
}

// 過去30日に投稿済みのcontent_idセットを返す（重複回避用）
export function getRecentlyPostedIds(days = 30): Set<string> {
  const data = loadData();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const ids = new Set<string>();
  for (const p of data.posts) {
    if (new Date(p.postedAt).getTime() > cutoff && p.item?.id) {
      ids.add(p.item.id);
    }
  }
  return ids;
}

export function updateMetrics(tweetId: string, metrics: any) {
  const data = loadData();
  const post = data.posts.find((p) => p.tweetId === tweetId);
  if (post) {
    post.metrics = { ...metrics, checkedAt: new Date().toISOString() };
    saveData(data);
  }
}

export function getTopPatterns(limit = 5): PostRecord[] {
  const data = loadData();
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const withMetrics = data.posts.filter(
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
  const data = loadData();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return data.posts
    .filter((p) => p.tweetId && new Date(p.postedAt).getTime() > cutoff)
    .map((p) => p.tweetId);
}

export function getAllPosts(): PostRecord[] {
  return loadData().posts;
}

// 指定時刻以降に投稿されたレコードを返す（取りこぼし検出用）
export function getPostsAfter(since: Date): PostRecord[] {
  return loadData().posts.filter((p) => new Date(p.postedAt) >= since);
}

// ─── External Patterns ───────────────────────────────────────────────────────

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

function loadExternalData(): ExternalPatternsData {
  ensureDir();
  if (!existsSync(EXT_FILE)) return { patterns: [], lastRefreshedAt: null, queries: [] };
  try {
    return JSON.parse(readFileSync(EXT_FILE, 'utf-8')) as ExternalPatternsData;
  } catch {
    return { patterns: [], lastRefreshedAt: null, queries: [] };
  }
}

function saveExternalData(data: ExternalPatternsData) {
  ensureDir();
  writeFileSync(EXT_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function upsertExternalPatterns(
  incoming: Omit<ExternalPattern, 'savedAt'>[],
  source: string,
) {
  const data = loadExternalData();
  const existingIds = new Set(data.patterns.map((p) => p.tweetId));
  let added = 0;
  for (const p of incoming) {
    if (!existingIds.has(p.tweetId)) {
      data.patterns.push({ ...p, source, savedAt: new Date().toISOString() });
      added++;
    } else {
      const existing = data.patterns.find((e) => e.tweetId === p.tweetId);
      if (existing) {
        existing.like_count = p.like_count;
        existing.retweet_count = p.retweet_count;
        existing.bookmark_count = p.bookmark_count;
        existing.impression_count = p.impression_count;
        existing.score = p.score;
      }
    }
  }
  data.patterns.sort((a, b) => b.score - a.score);
  data.patterns = data.patterns.slice(0, 100);
  data.lastRefreshedAt = new Date().toISOString();
  if (source && !data.queries.includes(source)) data.queries.push(source);
  saveExternalData(data);
  return added;
}

export function getExternalTopPatterns(limit = 5): ExternalPattern[] {
  const data = loadExternalData();
  return data.patterns.slice(0, limit);
}

export function getExternalPatternsInfo() {
  const data = loadExternalData();
  return {
    count: data.patterns.length,
    lastRefreshedAt: data.lastRefreshedAt,
    queries: data.queries,
    topPatterns: data.patterns.slice(0, 10),
  };
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export function getStats() {
  const posts = getAllPosts();
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
