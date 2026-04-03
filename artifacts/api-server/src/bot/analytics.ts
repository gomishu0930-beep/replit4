import { getRecentPostIds, updateMetrics, upsertExternalPatterns } from './storage.js';
import { getTweetMetrics, searchTweetsByHashtag } from './twitter.js';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function refreshRecentMetrics() {
  const ids = getRecentPostIds(7);
  if (!ids.length) {
    console.log('  指標更新対象の投稿がありません');
    return;
  }

  console.log(`  ${ids.length} 件の投稿の指標を更新中...`);
  for (const tweetId of ids) {
    const metrics = await getTweetMetrics(tweetId);
    if (metrics) {
      updateMetrics(tweetId, metrics);
      console.log(
        `    ✓ ${tweetId}: ❤${metrics.like_count} 🔁${metrics.retweet_count} 🔖${(metrics as any).bookmark_count ?? '-'}`,
      );
    }
    await sleep(1500);
  }
  console.log('  指標更新完了');
}

const SEARCH_QUERIES = [
  '#FANZA',
  '#fanza アフィリエイト',
  '#DMM 人気',
];

function calcScore(t: { like_count: number; retweet_count: number; reply_count: number; bookmark_count: number; impression_count: number }): number {
  return t.like_count + t.retweet_count * 3 + t.bookmark_count * 2 + t.reply_count;
}

export async function refreshExternalPatterns() {
  console.log('  🔍 外部パターン収集開始...');
  let totalAdded = 0;

  for (const query of SEARCH_QUERIES) {
    try {
      const tweets = await searchTweetsByHashtag(query, 30);
      const scored = tweets
        .map((t) => ({ ...t, score: calcScore(t) }))
        .filter((t) => t.score >= 5);

      const added = upsertExternalPatterns(scored, query);
      console.log(`    "${query}" → ${tweets.length} 件取得 / ${added} 件新規保存`);
      totalAdded += added;
      await sleep(2000);
    } catch (e: any) {
      console.warn(`    ⚠ "${query}" 検索失敗: ${e.message}`);
    }
  }

  console.log(`  外部パターン収集完了 (新規 ${totalAdded} 件)`);
  return totalAdded;
}
