import cron from 'node-cron';
import { mkdirSync } from 'fs';
import { resolve } from 'path';

import { getRankingItems, getSaleItems, getBuzzItems, getRandomItems, getAmateurItems, getSampleImages } from './fanza.js';
import { uploadImages, postTweet, replyToTweet } from './twitter.js';
import { generateTweetText, generateEngagementReply } from './ai.js';
import { recordPost, getTopPatterns, getExternalTopPatterns } from './storage.js';
import { refreshRecentMetrics, refreshExternalPatterns } from './analytics.js';

mkdirSync(resolve(process.cwd(), 'fanza-bot/data'), { recursive: true });

let isPosting = false;

// ランダム待機（凍結対策）
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function randomSleep(minSec: number, maxSec: number) {
  const ms = (minSec + Math.random() * (maxSec - minSec)) * 1000;
  console.log(`  ⏳ ${Math.round(ms / 1000)}秒 待機中...`);
  return sleep(ms);
}

async function postItem(item: any, type: string, label: string) {
  console.log(`  📝 [${label}] 投稿処理開始: ${item.title?.slice(0, 30)}`);

  const topPatterns = getTopPatterns(5);
  const externalPatterns = getExternalTopPatterns(5);
  const text = await generateTweetText(item, type, topPatterns, externalPatterns);
  const imageUrls = getSampleImages(item);
  const mediaIds = await uploadImages(imageUrls);
  const tweetId = await postTweet(text, mediaIds);

  // ツイート→リプライ間：30〜90秒待機（人間的な間隔）
  await randomSleep(30, 90);

  const affiliateURL = item.affiliateURL ?? '';
  const replyId = await replyToTweet(tweetId, `🔗 作品ページはこちら👇\n${affiliateURL}`);

  // リプライ1→2間：20〜60秒待機
  await randomSleep(20, 60);

  // 3投目：エンゲージメント誘導リプライ
  const engagementText = generateEngagementReply(type);
  await replyToTweet(replyId, engagementText);

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
    for (let i = 0; i < items.length; i++) {
      await postItem(items[i], type, label);
      // 作品間：5〜15分のランダム待機（スパム判定回避）
      if (i < items.length - 1) {
        await randomSleep(5 * 60, 15 * 60);
      }
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

  // 09:00 JST — 素人 2件
  cron.schedule('0 9 * * *', async () => {
    const items = await getAmateurItems(2);
    await postItems(items, 'amateur', '09:00 素人');
  }, { timezone: 'Asia/Tokyo' });

  // 12:00 JST — ランキング 2件
  cron.schedule('0 12 * * *', async () => {
    const items = await getRankingItems(2);
    await postItems(items, 'rank', '12:00 ランキング');
  }, { timezone: 'Asia/Tokyo' });

  // 18:00 JST — バズ 2件 + 指標更新
  cron.schedule('0 18 * * *', async () => {
    await refreshRecentMetrics();
    const items = await getBuzzItems(2);
    await postItems(items, 'buzz', '18:00 バズ');
  }, { timezone: 'Asia/Tokyo' });

  // 21:00 JST — ランダム 2件
  cron.schedule('0 21 * * *', async () => {
    const items = await getRandomItems(2);
    await postItems(items, 'random', '21:00 ランダム');
  }, { timezone: 'Asia/Tokyo' });

  // 23:00 JST — セール品 2件
  cron.schedule('0 23 * * *', async () => {
    const items = await getSaleItems(2);
    await postItems(items, 'sale', '23:00 セール');
  }, { timezone: 'Asia/Tokyo' });

  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║    FANZA X Bot スケジューラー起動        ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  06:00 JST  外部パターン収集             ║');
  console.log('║  09:00 JST  素人    2件（間隔ランダム）  ║');
  console.log('║  12:00 JST  ランキング 2件（間隔ランダム）║');
  console.log('║  18:00 JST  バズ    2件 + 指標更新      ║');
  console.log('║  21:00 JST  ランダム 2件（間隔ランダム）  ║');
  console.log('║  23:00 JST  セール   2件（間隔ランダム）  ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
}
