import cron from 'node-cron';
import { mkdirSync } from 'fs';
import { resolve } from 'path';

import { getRankingItems, getSaleItems, getBuzzItems, getRandomItems, getAmateurItems, getSampleImages } from './fanza.js';
import { uploadImages, postTweet, replyToTweet } from './twitter.js';
import { generateTweetText } from './ai.js';
import { recordPost, getTopPatterns, getExternalTopPatterns } from './storage.js';
import { refreshRecentMetrics, refreshExternalPatterns } from './analytics.js';

mkdirSync(resolve(process.cwd(), 'fanza-bot/data'), { recursive: true });

let isPosting = false;

async function postItem(item: any, type: string, label: string) {
  console.log(`  📝 [${label}] 投稿処理開始: ${item.title?.slice(0, 30)}`);

  const topPatterns = getTopPatterns(5);
  const externalPatterns = getExternalTopPatterns(5);
  const text = await generateTweetText(item, type, topPatterns, externalPatterns);
  const imageUrls = getSampleImages(item);
  const mediaIds = await uploadImages(imageUrls);
  const tweetId = await postTweet(text, mediaIds);

  const affiliateURL = item.affiliateURL ?? '';
  const replyId = await replyToTweet(tweetId, `🔗 作品ページはこちら👇\n${affiliateURL}`);

  recordPost({ tweetId, replyId, item, text, type });
  console.log(`  ✅ [${label}] 投稿完了 (${tweetId})`);
}

async function postItems(items: any[], type: string, label: string) {
  if (isPosting) {
    console.log(`  ⚠ [${label}] 前の投稿処理が進行中 — スキップ`);
    return;
  }
  isPosting = true;
  try {
    console.log(`\n[${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}] ${label} 投稿開始 (${items.length}件)`);
    for (const item of items) {
      await postItem(item, type, label);
    }
  } catch (e: any) {
    console.error(`  ❌ [${label}] エラー: ${e.message}`);
  } finally {
    isPosting = false;
  }
}

export function startScheduler() {
  // 06:00 JST — 外部パターン収集
  cron.schedule('0 6 * * *', async () => {
    console.log(`\n[${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}] 外部パターン収集開始`);
    try {
      await refreshExternalPatterns();
    } catch (e: any) {
      console.error(`  ❌ 外部パターン収集エラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 07:40 JST — 臨時テスト：外部パターン収集
  cron.schedule('40 7 * * *', async () => {
    console.log(`\n[${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}] 【臨時テスト】外部パターン収集開始`);
    try {
      await refreshExternalPatterns();
      console.log('  ✅ 臨時テスト収集完了');
    } catch (e: any) {
      console.error(`  ❌ 臨時テスト収集エラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 08:30 JST — 素人 3件
  cron.schedule('30 8 * * *', async () => {
    const items = await getAmateurItems(3);
    await postItems(items, 'amateur', '08:30 素人');
  }, { timezone: 'Asia/Tokyo' });

  // 12:00 JST — ランキング 3件
  cron.schedule('0 12 * * *', async () => {
    const items = await getRankingItems(3);
    await postItems(items, 'rank', '12:00 ランキング');
  }, { timezone: 'Asia/Tokyo' });

  // 15:00 JST — セール品 3件
  cron.schedule('0 15 * * *', async () => {
    const items = await getSaleItems(3);
    await postItems(items, 'sale', '15:00 セール');
  }, { timezone: 'Asia/Tokyo' });

  // 18:00 JST — バズ 3件 + 指標更新
  cron.schedule('0 18 * * *', async () => {
    await refreshRecentMetrics();
    const items = await getBuzzItems(3);
    await postItems(items, 'buzz', '18:00 バズ');
  }, { timezone: 'Asia/Tokyo' });

  // 21:00 JST — ランダム 3件
  cron.schedule('0 21 * * *', async () => {
    const items = await getRandomItems(3);
    await postItems(items, 'random', '21:00 ランダム');
  }, { timezone: 'Asia/Tokyo' });

  // 23:00 JST — セール品 3件
  cron.schedule('0 23 * * *', async () => {
    const items = await getSaleItems(3);
    await postItems(items, 'sale', '23:00 セール');
  }, { timezone: 'Asia/Tokyo' });

  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║    FANZA X Bot スケジューラー起動        ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  06:00 JST  外部パターン収集             ║');
  console.log('║  07:40 JST  【臨時テスト】外部パターン収集║');
  console.log('║  08:30 JST  素人 3件                     ║');
  console.log('║  12:00 JST  ランキング 3件               ║');
  console.log('║  15:00 JST  セール品 3件                 ║');
  console.log('║  18:00 JST  バズ 3件 + 指標更新          ║');
  console.log('║  21:00 JST  ランダム 3件                 ║');
  console.log('║  23:00 JST  セール品 3件                 ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
}
