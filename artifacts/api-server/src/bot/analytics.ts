import { getRecentPostIds, updateMetrics, upsertExternalPatterns } from './storage.js';
import { getTweetMetrics, searchTweetsByHashtag, fetchUserTimelineByUsername } from './twitter.js';

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
  '#DMM',
];

// 参照するアカウント一覧（環境変数 TRACK_ACCOUNTS でカンマ区切りで追加可能）
function getTrackAccounts(): string[] {
  const env = process.env.TRACK_ACCOUNTS ?? '';
  return env.split(',').map((s) => s.trim()).filter(Boolean);
}

function calcScore(t: { like_count: number; retweet_count: number; reply_count: number; bookmark_count: number; impression_count: number }): number {
  return t.like_count + t.retweet_count * 3 + t.bookmark_count * 2 + t.reply_count;
}

function isSearchTierError(e: any): boolean {
  const code = e?.code ?? e?.status ?? 0;
  const msg: string = e?.message ?? '';
  return code === 403 || code === 401 || msg.includes('403') || msg.includes('401') || msg.includes('not permitted');
}

export async function refreshExternalPatterns() {
  console.log('  🔍 外部パターン収集開始...');
  let totalAdded = 0;
  let searchSupported = true;

  // ① ハッシュタグ検索
  if (searchSupported) {
    for (const query of SEARCH_QUERIES) {
      try {
        const tweets = await searchTweetsByHashtag(query, 30);
        const scored = tweets
          .map((t) => ({ ...t, score: calcScore(t) }))
          .filter((t) => t.score >= 3);

        const added = upsertExternalPatterns(scored, query);
        console.log(`    "${query}" → ${tweets.length} 件取得 / ${added} 件新規保存`);
        totalAdded += added;
        await sleep(2000);
      } catch (e: any) {
        if (isSearchTierError(e)) {
          console.warn('    ⚠ 検索 API は現在のプランでは使用できません。アカウント別収集のみ実行します。');
          searchSupported = false;
          break;
        }
        console.warn(`    ⚠ "${query}" 検索失敗: ${e.message}`);
      }
    }
  }

  // ② アカウント別タイムライン取得（TRACK_ACCOUNTS 環境変数で指定）
  const trackAccounts = getTrackAccounts();
  if (trackAccounts.length > 0) {
    console.log(`    📋 追跡アカウント: ${trackAccounts.join(', ')}`);
    for (const username of trackAccounts) {
      try {
        const tweets = await fetchUserTimelineByUsername(username, 20);
        const scored = tweets
          .map((t) => ({ ...t, score: calcScore(t) }))
          .filter((t) => t.score >= 3);

        const added = upsertExternalPatterns(scored, `@${username}`);
        console.log(`    @${username} → ${tweets.length} 件取得 / ${added} 件新規保存`);
        totalAdded += added;
        await sleep(2000);
      } catch (e: any) {
        console.warn(`    ⚠ @${username} 取得失敗: ${e.message}`);
      }
    }
  } else if (!searchSupported) {
    console.log('    💡 参照アカウントを追加するには TRACK_ACCOUNTS 環境変数にユーザー名をカンマ区切りで設定してください');
    console.log('    例: TRACK_ACCOUNTS=fanza_bot1,dmm_affiliate2');
  }

  console.log(`  外部パターン収集完了 (新規 ${totalAdded} 件)`);
  return totalAdded;
}
