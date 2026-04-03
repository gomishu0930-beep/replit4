import { Router } from 'express';
import { getRankingItems, getSaleItems, getBuzzItems, getRandomItems, getSampleImages } from '../bot/fanza.js';
import { uploadImages, postTweet, replyToTweet } from '../bot/twitter.js';
import { generateTweetText } from '../bot/ai.js';
import { recordPost, getTopPatterns, getExternalTopPatterns } from '../bot/storage.js';

import { refreshRecentMetrics, refreshExternalPatterns } from '../bot/analytics.js';

const router = Router();

const TRIGGER_SECRET = process.env.TRIGGER_SECRET ?? 'fanza-bot-trigger';

let isPosting = false;

async function postItem(item: any, type: string) {
  const topPatterns = getTopPatterns(5);
  const externalPatterns = getExternalTopPatterns(5);
  const text = await generateTweetText(item, type, topPatterns, externalPatterns);
  const imageUrls = getSampleImages(item);
  const mediaIds = await uploadImages(imageUrls);
  const tweetId = await postTweet(text, mediaIds);
  const replyId = await replyToTweet(tweetId, `🔗 作品ページはこちら👇\n${item.affiliateURL ?? ''}`);
  recordPost({ tweetId, replyId, item, text, type });
  return tweetId;
}

async function runJob(type: string, label: string, fetchItems: () => Promise<any[]>) {
  if (isPosting) {
    return { skipped: true, reason: '別の投稿が進行中' };
  }
  isPosting = true;
  const results = [];
  try {
    const items = await fetchItems();
    for (const item of items) {
      const tweetId = await postItem(item, type);
      results.push({ tweetId, title: item.title });
    }
    console.log(`[${label}] ✅ ${results.length}件投稿完了`);
    return { ok: true, label, posted: results.length, results };
  } catch (e: any) {
    console.error(`[${label}] ❌ エラー: ${e.message}`);
    return { ok: false, label, error: e.message };
  } finally {
    isPosting = false;
  }
}

function auth(req: any, res: any, next: any) {
  const secret = req.headers['x-trigger-secret'] ?? req.query.secret;
  if (secret !== TRIGGER_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// 12:00 JST ランキング
router.post('/trigger/rank', auth, async (_req, res) => {
  const result = await runJob('rank', '12:00 ランキング', () => getRankingItems(3));
  res.json(result);
});

// 15:00 / 23:00 JST セール
router.post('/trigger/sale', auth, async (_req, res) => {
  const result = await runJob('sale', 'セール', () => getSaleItems(3));
  res.json(result);
});

// 18:00 JST バズ + 指標更新
router.post('/trigger/buzz', auth, async (_req, res) => {
  await refreshRecentMetrics();
  const result = await runJob('buzz', '18:00 バズ', () => getBuzzItems(3));
  res.json(result);
});

// 21:00 JST ランダム
router.post('/trigger/random', auth, async (_req, res) => {
  const result = await runJob('random', '21:00 ランダム', () => getRandomItems(3));
  res.json(result);
});

// 外部パターン収集 (06:00 JST / 手動)
router.post('/trigger/external-patterns', auth, async (_req, res) => {
  if (isPosting) {
    res.status(429).json({ ok: false, error: '投稿処理中のためスキップ' });
    return;
  }
  try {
    console.log('\n[外部パターン収集] 手動トリガー');
    const added = await refreshExternalPatterns();
    res.json({ ok: true, added });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
