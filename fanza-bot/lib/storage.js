import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

const DATA_DIR = './data';
const DB_FILE = `${DATA_DIR}/posts.json`;

function ensureDir() {
  mkdirSync(DATA_DIR, { recursive: true });
}

export function loadData() {
  ensureDir();
  if (!existsSync(DB_FILE)) {
    return { posts: [] };
  }
  try {
    return JSON.parse(readFileSync(DB_FILE, 'utf-8'));
  } catch {
    return { posts: [] };
  }
}

export function saveData(data) {
  ensureDir();
  writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function recordPost({ tweetId, replyId, item, text, type }) {
  const data = loadData();
  data.posts.push({
    tweetId,
    replyId,
    type,
    text,
    item: {
      id: item.content_id,
      title: item.title,
      affiliateURL: item.affiliateURL,
    },
    postedAt: new Date().toISOString(),
    metrics: null,
  });
  saveData(data);
}

export function updateMetrics(tweetId, metrics) {
  const data = loadData();
  const post = data.posts.find((p) => p.tweetId === tweetId);
  if (post) {
    post.metrics = { ...metrics, checkedAt: new Date().toISOString() };
    saveData(data);
  }
}

/**
 * 過去7日間の投稿のうち指標あり上位5件を返す
 * AI プロンプトの参考パターンとして使う
 */
export function getTopPatterns(limit = 5) {
  const data = loadData();
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const withMetrics = data.posts.filter(
    (p) => p.metrics && new Date(p.postedAt).getTime() > oneWeekAgo,
  );

  withMetrics.sort((a, b) => {
    const score = (m) =>
      (m.like_count || 0) +
      (m.retweet_count || 0) * 3 +
      (m.bookmark_count || 0) * 2 +
      (m.reply_count || 0);
    return score(b.metrics) - score(a.metrics);
  });

  return withMetrics.slice(0, limit);
}

export function getRecentPostIds(days = 7) {
  const data = loadData();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return data.posts
    .filter((p) => p.tweetId && new Date(p.postedAt).getTime() > cutoff)
    .map((p) => p.tweetId);
}

export function getAllPosts() {
  return loadData().posts;
}
