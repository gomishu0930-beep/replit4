/**
 * FANZA X Bot — メインスケジューラー
 *
 * 起動方法: node index.js
 * プロセスを常駐させることでスケジュール投稿が動作します。
 * macOS で自動起動したい場合は launchd (plist) を使ってください。
 */

import 'dotenv/config';
import cron from 'node-cron';
import { mkdirSync } from 'fs';

import { getRankingItems, getSaleItems, getBuzzItems, getRandomItems, getSampleImages } from './lib/fanza.js';
import { uploadImages, postTweet, replyToTweet } from './lib/twitter.js';
import { generateTweetText } from './lib/ai.js';
import { recordPost, getTopPatterns } from './lib/storage.js';
import { refreshRecentMetrics } from './lib/analytics.js';

mkdirSync('./data', { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 1アイテムを投稿する
 * 1. AI でツイート本文を生成
 * 2. サンプル画像4枚をアップロード
 * 3. 本文 + 画像でツイート
 * 4. リプライにアフィリエイトリンクを投稿
 */
async function postItem(item, type, topPatterns) {
  console.log(`  📦 "${item.title.slice(0, 30)}..."`);

  const text = await generateTweetText(item, type, topPatterns);
  console.log(`  ✏  ${text.slice(0, 60)}...`);

  const imageUrls = getSampleImages(item);
  const mediaIds = await uploadImages(imageUrls);
  console.log(`  🖼  画像アップロード ${mediaIds.length}/4 枚`);

  const tweetId = await postTweet(text, mediaIds);
  console.log(`  🐦 ツイート投稿: https://x.com/i/web/status/${tweetId}`);

  const linkText = `🔗 作品ページ・購入はこちら\n${item.affiliateURL}`;
  const replyId = await replyToTweet(tweetId, linkText);
  console.log(`  ↩  リプライ投稿: ${replyId}`);

  recordPost({ tweetId, replyId, item, text, type });

  return tweetId;
}

/**
 * 複数アイテムをまとめて投稿する（投稿間に30秒のインターバル）
 */
async function postItems(items, type, label) {
  const topPatterns = getTopPatterns();
  console.log(`\n🚀 [${label}] ${items.length} 件の投稿を開始 (参考パターン ${topPatterns.length} 件)\n`);

  for (let i = 0; i < items.length; i++) {
    try {
      await postItem(items[i], type, topPatterns);
    } catch (e) {
      console.error(`  ❌ 投稿失敗 (${items[i].content_id}): ${e.message}`);
    }

    if (i < items.length - 1) {
      console.log('  ⏳ 30秒待機...');
      await sleep(30_000);
    }
  }

  console.log(`\n✅ [${label}] 完了\n`);
}

// ─── スケジュール定義（JST） ────────────────────────────────────────────────

// 12:00 — ランキング 3件
cron.schedule('0 12 * * *', async () => {
  const items = await getRankingItems(3);
  await postItems(items, 'rank', '12:00 ランキング');
}, { timezone: 'Asia/Tokyo' });

// 15:00 — セール品 3件
cron.schedule('0 15 * * *', async () => {
  const items = await getSaleItems(3);
  await postItems(items, 'sale', '15:00 セール');
}, { timezone: 'Asia/Tokyo' });

// 18:00 — 指標更新 → バズ 3件
cron.schedule('0 18 * * *', async () => {
  console.log('\n📊 [18:00] 過去投稿の指標を更新中...');
  await refreshRecentMetrics();
  const items = await getBuzzItems(3);
  await postItems(items, 'buzz', '18:00 バズ');
}, { timezone: 'Asia/Tokyo' });

// 21:00 — ランダム 3件
cron.schedule('0 21 * * *', async () => {
  const items = await getRandomItems(3);
  await postItems(items, 'random', '21:00 ランダム');
}, { timezone: 'Asia/Tokyo' });

// 23:00 — セール品 3件
cron.schedule('0 23 * * *', async () => {
  const items = await getSaleItems(3);
  await postItems(items, 'sale', '23:00 セール');
}, { timezone: 'Asia/Tokyo' });

// ─── 起動メッセージ ─────────────────────────────────────────────────────────

console.log('');
console.log('╔══════════════════════════════════════════╗');
console.log('║        FANZA X Bot 起動                  ║');
console.log('╠══════════════════════════════════════════╣');
console.log('║  12:00  ランキング 3件                   ║');
console.log('║  15:00  セール品 3件                     ║');
console.log('║  18:00  バズ 3件 + 指標更新              ║');
console.log('║  21:00  ランダム 3件                     ║');
console.log('║  23:00  セール品 3件                     ║');
console.log('╚══════════════════════════════════════════╝');
console.log('');
console.log('スケジュール待機中... Ctrl+C で終了');
console.log('');
