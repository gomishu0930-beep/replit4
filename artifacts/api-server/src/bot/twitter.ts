import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY ?? '',
  appSecret: process.env.TWITTER_API_SECRET ?? '',
  accessToken: process.env.TWITTER_ACCESS_TOKEN ?? '',
  accessSecret: process.env.TWITTER_ACCESS_SECRET ?? '',
});

const rw = client.readWrite;

async function downloadImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': 'FanzaBot/1.0' } });
  if (!res.ok) throw new Error(`Image download failed: ${url} (${res.status})`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

export async function uploadImages(imageUrls: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const url of imageUrls.slice(0, 4)) {
    try {
      const buf = await downloadImageBuffer(url);
      const id = await rw.v1.uploadMedia(buf, { mimeType: 'image/jpeg' });
      ids.push(id);
    } catch (e: any) {
      console.error(`  ⚠ 画像アップロード失敗 (${url}): ${e.message}`);
    }
  }
  return ids;
}

export async function postTweet(text: string, mediaIds: string[] = []): Promise<string> {
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
    return res.data.public_metrics ?? null;
  } catch (e: any) {
    console.error(`  ⚠ 指標取得失敗 (${tweetId}): ${e.message}`);
    return null;
  }
}

export async function getOwnRecentTweets(count = 20) {
  const userId = process.env.TWITTER_USER_ID;
  if (!userId) throw new Error('TWITTER_USER_ID が設定されていません');

  const res = await rw.v2.userTimeline(userId, {
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
  const myUserId = process.env.TWITTER_USER_ID ?? '';
  const exclusion = myUserId ? ` -from:${myUserId}` : '';
  const fullQuery = `${query} has:media lang:ja -is:retweet${exclusion}`;

  const res = await client.v2.search(fullQuery, {
    max_results: Math.min(maxResults, 100),
    'tweet.fields': ['public_metrics', 'created_at', 'author_id'],
    sort_order: 'relevancy',
  });

  const tweets: SearchedTweet[] = [];
  for (const t of res.data?.data ?? []) {
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
