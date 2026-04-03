/**
 * 手動テスト用スクリプト
 * 使い方: node post-now.js [type]
 *   type: rank | sale | buzz | random  (省略時: rank)
 *
 * 例: node post-now.js sale
 */

import 'dotenv/config';
import { mkdirSync } from 'fs';

import { getRankingItems, getSaleItems, getBuzzItems, getRandomItems, getSampleImages } from './lib/fanza.js';
import { uploadImages, postTweet, replyToTweet } from './lib/twitter.js';
import { generateTweetText } from './lib/ai.js';
import { recordPost, getTopPatterns } from './lib/storage.js';

mkdirSync('./data', { recursive: true });

const type = process.argv[2] || 'rank';

const fetchers = {
  rank: () => getRankingItems(1),
  sale: () => getSaleItems(1),
  buzz: () => getBuzzItems(1),
  random: () => getRandomItems(1),
};

if (!fetchers[type]) {
  console.error(`不明なタイプ: ${type}`);
  console.error('使い方: node post-now.js [rank|sale|buzz|random]');
  process.exit(1);
}

(async () => {
  console.log(`\n🧪 テスト投稿: type=${type}\n`);

  const [item] = await fetchers[type]();
  if (!item) {
    console.error('作品が取得できませんでした。');
    process.exit(1);
  }

  console.log(`作品: ${item.title}`);

  const topPatterns = getTopPatterns();
  const text = await generateTweetText(item, type, topPatterns);
  console.log(`\n生成テキスト:\n${text}\n`);

  const imageUrls = getSampleImages(item);
  console.log(`画像 ${imageUrls.length} 枚をアップロード中...`);
  const mediaIds = await uploadImages(imageUrls);
  console.log(`アップロード完了: ${mediaIds.length} 枚`);

  const tweetId = await postTweet(text, mediaIds);
  console.log(`\n✅ ツイート投稿完了: https://x.com/i/web/status/${tweetId}`);

  const linkText = `🔗 作品ページ・購入はこちら\n${item.affiliateURL}`;
  const replyId = await replyToTweet(tweetId, linkText);
  console.log(`✅ リプライ投稿完了: ${replyId}`);

  recordPost({ tweetId, replyId, item, text, type });
  console.log('\n📝 投稿を記録しました。\n');
})();
