import { Router } from 'express';
import { getHighRatedItems, getSaleItems, getBuzzItems, getRandomItems, getAmateurItems, getKeywordItems, getItemById, getSampleImages } from '../bot/fanza.js';
import { uploadImages, postTweet, replyToTweet } from '../bot/twitter.js';
import { generateTweetText, generateEngagementReply } from '../bot/ai.js';
import { recordPost, getTopPatterns, getExternalTopPatterns, getPostsAfter, getRebrandlyData, upsertRebrandlyLinks } from '../bot/storage.js';
import { getMeetingById, getMeetings } from '../bot/meeting.js';
import { getIsPosting as getSchedulerIsPosting } from '../bot/scheduler.js';
import { runMeetingAndPost, runAutonomousMeeting, runEmergencyMeeting } from '../bot/auto-meeting.js';
import { refreshRecentMetrics, refreshExternalPatterns } from '../bot/analytics.js';
import { diagnoseSheetsConnection, backfillAllData } from '../bot/sheets-writer.js';
import { getAllPosts } from '../bot/storage.js';
import { getStrategySummary } from '../bot/strategy.js';
import { validatePost, recordPostEvent } from '../bot/safety-engine.js';

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
  const engagementText = generateEngagementReply(type);
  await replyToTweet(replyId, engagementText);
  recordPost({ tweetId, replyId, item, text, type });
  recordPostEvent(true);
  return tweetId;
}

async function runJob(type: string, label: string, fetchItems: () => Promise<any[]>) {
  if (isPosting || getSchedulerIsPosting()) {
    return { skipped: true, reason: '別の投稿が進行中' };
  }

  const validation = validatePost(true);
  if (!validation.allowed) {
    return { skipped: true, reason: '安全制限', validation };
  }

  isPosting = true;
  const results = [];
  try {
    const allItems = await fetchItems();
    const items = allItems.slice(0, 3);
    for (const item of items) {
      const check = validatePost(true);
      if (!check.allowed) break;
      const tweetId = await postItem(item, type);
      results.push({ tweetId, title: item.title });
    }
    return { ok: true, label, posted: results.length, results };
  } catch (e: any) {
    return { ok: false, label, error: e.message };
  } finally {
    isPosting = false;
  }
}

function auth(req: any, res: any, next: any) {
  const secret = req.headers['x-trigger-secret'] ?? req.query.secret;
  if (secret !== TRIGGER_SECRET) { res.status(401).json({ error: 'Unauthorized' }); return; }
  next();
}

router.post('/trigger/rank', auth, async (_req, res) => {
  const result = await runJob('buzz', '高評価', () => getHighRatedItems(2));
  res.json(result);
});

router.post('/trigger/sale', auth, async (_req, res) => {
  const result = await runJob('sale', 'セール', () => getSaleItems(3));
  res.json(result);
});

router.post('/trigger/buzz', auth, async (_req, res) => {
  await refreshRecentMetrics();
  const result = await runJob('buzz', 'バズ', () => getBuzzItems(3));
  res.json(result);
});

router.post('/trigger/random', auth, async (_req, res) => {
  const result = await runJob('random', 'ランダム', () => getRandomItems(3));
  res.json(result);
});

router.post('/trigger/amateur', auth, async (_req, res) => {
  const result = await runJob('amateur', '素人', () => getAmateurItems(3));
  res.json(result);
});

router.post('/trigger/cid', auth, async (req, res) => {
  const cid = (req.query.cid as string) || (req.body?.cid as string);
  if (!cid) { res.status(400).json({ error: 'cid を指定してください' }); return; }
  if (isPosting || getSchedulerIsPosting()) { res.status(429).json({ error: '投稿進行中' }); return; }

  const validation = validatePost(true);
  if (!validation.allowed) { res.status(429).json({ error: '安全制限', validation }); return; }

  isPosting = true;
  try {
    const item = await getItemById(cid);
    if (!item) { res.status(404).json({ error: `商品ID [${cid}] が見つかりません` }); return; }
    const tweetId = await postItem(item, 'amateur');
    res.json({ ok: true, tweetId, title: item.title });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  } finally {
    isPosting = false;
  }
});

router.post('/trigger/keyword', auth, async (req, res) => {
  const keyword = (req.query.q as string) || (req.body?.keyword as string);
  if (!keyword) { res.status(400).json({ error: 'q を指定してください' }); return; }
  const result = await runJob('amateur', `キーワード[${keyword}]`, () => getKeywordItems(keyword, 1));
  res.json(result);
});

router.post('/trigger/meeting-post', auth, (req, res) => {
  const bypass = req.query.bypass === 'true' || req.body?.bypassDailyLimit === true;
  res.status(202).json({ ok: true, message: 'AI会議→投稿を開始しました' });
  runMeetingAndPost({ bypassDailyLimit: bypass }).catch(e => console.error(`[会議投稿] エラー: ${e.message}`));
});

router.post('/trigger/metrics', auth, async (_req, res) => {
  try {
    await refreshRecentMetrics();
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/trigger/external-patterns', auth, async (_req, res) => {
  if (isPosting) { res.status(429).json({ error: '投稿処理中' }); return; }
  try {
    const added = await refreshExternalPatterns();
    res.json({ ok: true, added });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

let isEmergencyMeetingRunning = false;
router.post('/trigger/emergency-meeting', auth, async (_req, res) => {
  if (isEmergencyMeetingRunning) { res.status(429).json({ error: '実行中' }); return; }
  isEmergencyMeetingRunning = true;
  res.json({ ok: true, message: '緊急会議開始' });
  runEmergencyMeeting().catch(e => console.error('緊急会議エラー:', e.message)).finally(() => { isEmergencyMeetingRunning = false; });
});

let isStrategyMeetingRunning = false;
router.post('/trigger/strategy-meeting', auth, (req, res) => {
  if (isStrategyMeetingRunning) { res.status(429).json({ error: '実行中' }); return; }
  isStrategyMeetingRunning = true;
  const topic = req.body?.topic;
  res.json({ ok: true, message: '戦略会議開始' });
  runAutonomousMeeting(topic).catch(e => console.error('戦略会議エラー:', e.message)).finally(() => { isStrategyMeetingRunning = false; });
});

router.post('/trigger/sync-rebrandly', auth, async (_req, res) => {
  try {
    const REBRANDLY_API_KEY = process.env.REBRANDLY_API_KEY ?? '';
    const resp = await fetch('https://api.rebrandly.com/v1/links?limit=50', { headers: { apikey: REBRANDLY_API_KEY } });
    const links: any[] = await resp.json();
    upsertRebrandlyLinks(links.map((l: any) => ({
      slashtag: l.slashtag,
      shortUrl: l.shortUrl ?? `rebrand.ly/${l.slashtag}`,
      destination: l.destination,
      clicks: l.clicks ?? 0,
      createdAt: l.createdAt ?? new Date().toISOString(),
    })));
    const posts = getPostsAfter(new Date(Date.now() - 30 * 86400000));
    const rbData = getRebrandlyData();
    const totalImp = posts.reduce((s: number, p: any) => s + (p.metrics?.impression_count ?? 0), 0);
    const totalClicks = rbData.links.reduce((s: number, l: any) => s + l.clicks, 0);
    const ctr = totalImp > 0 ? (totalClicks / totalImp * 100).toFixed(3) : '0.000';
    res.json({ ok: true, totalLinks: links.length, totalClicks, ctr_pct: `${ctr}%` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/trigger/sheets-diagnose', auth, async (_req, res) => {
  try {
    const diag = await diagnoseSheetsConnection();
    res.json({ ok: true, ...diag });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/trigger/sheets-backfill', auth, async (_req, res) => {
  try {
    const result = await backfillAllData();
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
