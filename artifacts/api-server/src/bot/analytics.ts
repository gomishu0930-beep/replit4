import { getRecentPostIds, updateMetrics } from './storage.js';
import { getTweetMetrics } from './twitter.js';

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
