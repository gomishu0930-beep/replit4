import { getRecentPostIds, updateMetrics, getAllPosts } from './storage.js';
import { getTweetMetrics } from './twitter.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 過去7日分の投稿の指標を更新する（18:00 の投稿前に実行）
 */
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
        `    ✓ ${tweetId}: ❤${metrics.like_count} 🔁${metrics.retweet_count} 🔖${metrics.bookmark_count ?? '-'}`,
      );
    }
    await sleep(1500); // レート制限対策
  }
  console.log('  指標更新完了');
}

/**
 * 全投稿の簡易レポートをコンソールに出力
 */
export function printReport() {
  const posts = getAllPosts();
  if (!posts.length) {
    console.log('投稿データがありません。');
    return;
  }

  console.log('\n═══════════════════════════════════════════');
  console.log(' FANZA Bot 投稿レポート');
  console.log('═══════════════════════════════════════════');

  const withMetrics = posts.filter((p) => p.metrics);
  const noMetrics = posts.filter((p) => !p.metrics);

  console.log(`総投稿数: ${posts.length} 件`);
  console.log(`指標取得済: ${withMetrics.length} 件 / 未取得: ${noMetrics.length} 件\n`);

  if (withMetrics.length) {
    withMetrics.sort((a, b) => {
      const score = (m) => (m.like_count ?? 0) + (m.retweet_count ?? 0) * 3;
      return score(b.metrics) - score(a.metrics);
    });

    console.log('【エンゲージメント上位 10 件】');
    withMetrics.slice(0, 10).forEach((p, i) => {
      const m = p.metrics;
      const date = new Date(p.postedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
      console.log(`${i + 1}. [${p.type}] ${date}`);
      console.log(`   ❤${m.like_count} 🔁${m.retweet_count} 🔖${m.bookmark_count ?? '-'} 💬${m.reply_count ?? '-'}`);
      console.log(`   ${p.item.title.slice(0, 40)}...`);
      console.log(`   ${p.text.slice(0, 60)}...`);
      console.log();
    });
  }
}
