import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const DATA_DIR = resolve(process.cwd(), 'fanza-bot/data');
const DB_FILE = resolve(DATA_DIR, 'posts.json');

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
