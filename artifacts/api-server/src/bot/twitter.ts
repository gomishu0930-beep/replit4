import { TwitterApi } from 'twitter-api-v2';
import { readJson, writeJson } from './cloudStore.js';

const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY ?? '',
  appSecret: process.env.TWITTER_API_SECRET ?? '',
  accessToken: process.env.TWITTER_ACCESS_TOKEN ?? '',
  accessSecret: process.env.TWITTER_ACCESS_SECRET ?? '',
});

const rw = client.readWrite;

// ─── 緊急停止フラグ ───────────────────────────────────────────────────────────

let _botPaused = false;
let _pausedReason = '';

export function isBotPaused(): boolean { return _botPaused; }
export function getPausedReason(): string { return _pausedReason; }

export async function pauseBot(reason: string): Promise<void> {
  _botPaused = true;
  _pausedReason = reason;
  await writeJson('bot-pause-state.json', { paused: true, reason, pausedAt: new Date().toISOString() });
  console.log(`  🛑 [緊急停止] ボット全投稿を停止: ${reason}`);
}

export async function resumeBot(): Promise<void> {
  _botPaused = false;
  _pausedReason = '';
  await writeJson('bot-pause-state.json', { paused: false, reason: '', resumedAt: new Date().toISOString() });
  console.log('  ▶️  [再開] ボット投稿を再開');
}

export async function loadPauseState(): Promise<void> {
  try {
    const state = await readJson<{ paused: boolean; reason: string }>('bot-pause-state.json', { paused: false, reason: '' });
    _botPaused = state.paused;
    _pausedReason = state.reason ?? '';
    if (_botPaused) {
      console.log(`  🛑 [起動] 停止フラグ検出: ${_pausedReason}`);
    }
  } catch { /* 初回はファイルなし */ }
}

let _cachedUsername: string | null = null;
let _cachedNumericId: string | null = null;

async function getMyNumericId(): Promise<string> {
  if (_cachedNumericId) return _cachedNumericId;
  const res = await rw.v2.me({});
  _cachedNumericId = res.data.id;
  return _cachedNumericId;
}

export async function getMyUsername(): Promise<string> {
  if (_cachedUsername) return _cachedUsername;

  // TWITTER_USER_ID がユーザー名（@xxx）で設定されている場合はそのまま使用
  const userId = process.env.TWITTER_USER_ID ?? '';
  if (userId.startsWith('@')) {
    _cachedUsername = userId;
    return _cachedUsername;
  }

  // TWITTER_USERNAME が設定されている場合はそちらを優先
  if (process.env.TWITTER_USERNAME) {
    _cachedUsername = `@${process.env.TWITTER_USERNAME.replace(/^@/, '')}`;
    return _cachedUsername;
  }

  // 数値IDの場合はTwitter APIで名前解決
  if (userId && /^\d+$/.test(userId)) {
    try {
      const res = await client.v2.user(userId, { 'user.fields': ['username'] });
      _cachedUsername = `@${res.data.username}`;
      return _cachedUsername;
    } catch {
      // 取得失敗時はIDをそのまま表示
    }
  }

  return userId ? `ID:${userId}` : '不明';
}

async function downloadImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': 'FanzaBot/1.0' } });
  if (!res.ok) throw new Error(`Image download failed: ${url} (${res.status})`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function downloadImageBufferWithMime(url: string): Promise<{ buf: Buffer; mimeType: string }> {
  const res = await fetch(url, { headers: { 'User-Agent': 'FanzaBot/1.0' } });
  if (!res.ok) throw new Error(`Image download failed: ${url} (${res.status})`);
  const contentType = res.headers.get('content-type') ?? '';
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  // MIME判定: content-typeが明示されていればそれを使う、なければURLの拡張子から推定
  let mimeType = 'image/jpeg';
  if (contentType.startsWith('image/')) {
    mimeType = contentType.split(';')[0].trim();
  } else if (url.match(/\.png(\?|$)/i)) {
    mimeType = 'image/png';
  } else if (url.match(/\.webp(\?|$)/i)) {
    mimeType = 'image/webp';
  } else if (url.match(/\.gif(\?|$)/i)) {
    mimeType = 'image/gif';
  }
  return { buf, mimeType };
}

export async function uploadImages(imageUrls: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const url of imageUrls.slice(0, 4)) {
    try {
      const { buf, mimeType } = await downloadImageBufferWithMime(url);
      const id = await rw.v1.uploadMedia(buf, { mimeType });
      ids.push(id);
    } catch (e: any) {
      console.error(`  ⚠ 画像アップロード失敗 (${url}): ${e.message}`);
    }
  }
  return ids;
}

export async function postTweet(text: string, mediaIds: string[] = []): Promise<string> {
  if (_botPaused) {
    throw new Error(`🛑 ボット停止中につき投稿をブロックしました（理由: ${_pausedReason}）`);
  }
  const params: any = { text };
  if (mediaIds.length > 0) {
    params.media = { media_ids: mediaIds };
  }
  const res = await rw.v2.tweet(params);
  return res.data.id;
}

export async function replyToTweet(tweetId: string, text: string): Promise<string> {
  const res = await rw.v2.tweet({
    text,
    reply: { in_reply_to_tweet_id: tweetId },
  });
  return res.data.id;
}

export async function getTweetMetrics(tweetId: string) {
  try {
    const res = await rw.v2.singleTweet(tweetId, {
      'tweet.fields': ['public_metrics'],
    });
    return res.data?.public_metrics ?? null;
  } catch (e: any) {
    const code = e?.code ?? e?.status ?? e?.statusCode ?? '?';
    const detail = e?.data?.detail ?? e?.errors?.[0]?.message ?? '';
    console.error(`  ⚠ 指標取得失敗 (${tweetId}): HTTP ${code} ${e.message}${detail ? ' | ' + detail : ''}`);
    return null;
  }
}

export async function checkTwitterApiAccess(): Promise<{ ok: boolean; plan?: string; error?: string; code?: number }> {
  try {
    // 自分のツイートを1件読み込むだけのテスト
    const userId = await getMyNumericId();
    const res = await rw.v2.userTimeline(userId, { max_results: 5, 'tweet.fields': ['public_metrics'] });
    const count = res.data?.data?.length ?? 0;
    return { ok: true, plan: `読み取り成功 (${count}件取得)` };
  } catch (e: any) {
    const code = e?.code ?? e?.status ?? e?.statusCode ?? 0;
    const detail = e?.data?.detail ?? e?.errors?.[0]?.message ?? e?.message ?? '不明';
    return { ok: false, code: Number(code), error: detail };
  }
}

export async function getTweetById(tweetId: string): Promise<{
  id: string; text: string; createdAt: string; metrics: Record<string, number> | null;
} | null> {
  try {
    const res = await rw.v2.singleTweet(tweetId, {
      'tweet.fields': ['public_metrics', 'created_at', 'text'],
    });
    if (!res.data) return null;
    return {
      id: res.data.id,
      text: res.data.text,
      createdAt: (res.data as any).created_at ?? new Date().toISOString(),
      metrics: res.data.public_metrics ?? null,
    };
  } catch (e: any) {
    console.error(`  ⚠ ツイート取得失敗 (${tweetId}): ${e.message}`);
    return null;
  }
}

export async function getOwnRecentTweets(count = 20) {
  // TWITTER_USER_ID が @username 形式の場合は /v2/users/me で数値IDを解決する
  const numericId = await getMyNumericId();

  const res = await rw.v2.userTimeline(numericId, {
    max_results: Math.min(count, 100),
    'tweet.fields': ['public_metrics', 'created_at'],
  });
  return res.data?.data ?? [];
}

export interface SearchedTweet {
  id: string;
  text: string;
  authorId: string;
  like_count: number;
  retweet_count: number;
  reply_count: number;
  bookmark_count: number;
  impression_count: number;
  createdAt: string;
}

export async function searchTweetsByHashtag(
  query: string,
  maxResults = 20,
): Promise<SearchedTweet[]> {
  const fullQuery = `${query} -is:retweet lang:ja`;

  const res = await client.v2.search(fullQuery, {
    max_results: Math.min(Math.max(maxResults, 10), 100),
    'tweet.fields': ['public_metrics', 'created_at', 'author_id'],
  });

  // TWITTER_USER_ID が @username 形式でも正しく比較できるよう数値IDを使う
  const myNumericId = _cachedNumericId ?? '';
  const tweets: SearchedTweet[] = [];
  for (const t of res.data?.data ?? []) {
    if (myNumericId && t.author_id === myNumericId) continue;
    const m = t.public_metrics ?? ({} as any);
    tweets.push({
      id: t.id,
      text: t.text,
      authorId: t.author_id ?? '',
      like_count: m.like_count ?? 0,
      retweet_count: m.retweet_count ?? 0,
      reply_count: m.reply_count ?? 0,
      bookmark_count: m.bookmark_count ?? 0,
      impression_count: m.impression_count ?? 0,
      createdAt: t.created_at ?? new Date().toISOString(),
    });
  }
  return tweets;
}

// ─── アカウント情報取得（無料プランで動作可能）──────────────────────────────

export interface AccountInfo {
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  username: string;
}

export async function getAccountInfo(): Promise<AccountInfo | null> {
  try {
    // rw.v2.me() は OAuth認証済みユーザーの情報を取得（ユーザーID不要）
    const res = await rw.v2.me({
      'user.fields': ['public_metrics', 'username'],
    });

    const m = res.data.public_metrics;
    return {
      followersCount: m?.followers_count ?? 0,
      followingCount: m?.following_count ?? 0,
      tweetCount:     m?.tweet_count ?? 0,
      username:       res.data.username ?? '',
    };
  } catch (e: any) {
    console.error(`  ⚠ アカウント情報取得失敗: ${e.message}`);
    return null;
  }
}

export async function fetchUserTimelineByUsername(
  username: string,
  count = 20,
): Promise<SearchedTweet[]> {
  const userRes = await client.v2.userByUsername(username, {});
  const userId = userRes.data?.id;
  if (!userId) throw new Error(`ユーザー @${username} が見つかりません`);

  const res = await client.v2.userTimeline(userId, {
    max_results: Math.min(count, 100),
    'tweet.fields': ['public_metrics', 'created_at', 'author_id'],
    exclude: ['retweets', 'replies'],
  });

  const tweets: SearchedTweet[] = [];
  for (const t of res.data?.data ?? []) {
    const m = t.public_metrics ?? ({} as any);
    tweets.push({
      id: t.id,
      text: t.text,
      authorId: userId,
      like_count: m.like_count ?? 0,
      retweet_count: m.retweet_count ?? 0,
      reply_count: m.reply_count ?? 0,
      bookmark_count: m.bookmark_count ?? 0,
      impression_count: m.impression_count ?? 0,
      createdAt: t.created_at ?? new Date().toISOString(),
    });
  }
  return tweets;
}
