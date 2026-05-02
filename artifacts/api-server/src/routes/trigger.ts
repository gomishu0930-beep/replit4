import { Router } from 'express';
import { getHighRatedItems, getSaleItems, getBuzzItems, getRandomItems, getAmateurItems, getKeywordItems, getItemById, getSampleImages } from '../bot/fanza.js';
import { uploadImages, postTweet, replyToTweet, pauseBot, resumeBot, isBotPaused, getPausedReason } from '../bot/twitter.js';
import { generateTweetText, generateEngagementReply } from '../bot/ai.js';
import { recordPost, getTopPatterns, getExternalTopPatterns, getPostsAfter, getRebrandlyData, getAllPosts } from '../bot/storage.js';
import { getDirectives } from '../bot/meeting.js';
import { getIsPosting as getSchedulerIsPosting } from '../bot/scheduler.js';
import { refreshRecentMetrics, refreshExternalPatterns } from '../bot/analytics.js';
import { diagnoseSheetsConnection, backfillAllData } from '../bot/sheets-writer.js';
import { getStrategySummary } from '../bot/strategy.js';
import { validatePost, recordPostEvent } from '../bot/safety-engine.js';
import { resolveShortUrl, syncRebrandlyClicks } from '../bot/rebrandly.js';
import { pickAffiliateReplyCopy } from '../bot/post-analytics.js';

const router = Router();
const TRIGGER_SECRET = process.env.TRIGGER_SECRET ?? 'fanza-bot-trigger';
let isPosting = false;

async function postItem(item: any, type: string) {
  const topPatterns = getTopPatterns(5);
  const externalPatterns = getExternalTopPatterns(5);
  const result = await generateTweetText(item, type, topPatterns, externalPatterns);
  const text = result.text;
  const imagePrompt = result.imagePrompt;
  const imageUrls = getSampleImages(item);
  const mediaIds = await uploadImages(imageUrls);
  const tweetId = await postTweet(text, mediaIds);
  const affiliateURL = await resolveShortUrl(item.affiliateURL ?? '', item.content_id ?? item.id, item.title);
  const linkReply = pickAffiliateReplyCopy(affiliateURL);
  const replyId = await replyToTweet(tweetId, linkReply.text);
  const engagementText = generateEngagementReply(type);
  await replyToTweet(replyId, engagementText);
  recordPost({ tweetId, replyId, item, text, type, imagePrompt });
  recordPostEvent(true);
  return tweetId;
}

async function runJob(type: string, label: string, fetchItems: () => Promise<any[]>) {
  if (isPosting || getSchedulerIsPosting()) {
    return { skipped: true, reason: '別の投稿が進行中' };
  }

  isPosting = true;
  const results = [];
  try {
    const allItems = await fetchItems();
    const items = allItems.slice(0, 3);
    for (const item of items) {
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
  if (secret === TRIGGER_SECRET) { return next(); }
  const origin = req.headers.origin as string | undefined;
  const referer = req.headers.referer as string | undefined;
  const replitDomain = process.env.REPLIT_DEV_DOMAIN ?? process.env.REPLIT_DEPLOYMENT_DOMAIN;
  if (replitDomain) {
    const isSameOrigin = (origin?.includes(replitDomain) || referer?.includes(replitDomain));
    if (isSameOrigin) { return next(); }
  }
  if (process.env.NODE_ENV === 'development') { return next(); }
  res.status(401).json({ error: 'Unauthorized' });
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

router.post('/trigger/meeting-post', auth, (_req, res) => {
  res.status(410).json({ ok: false, error: 'auto-meeting は無効化されています' });
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

router.post('/trigger/emergency-meeting', auth, async (_req, res) => {
  res.status(410).json({ ok: false, error: 'auto-meeting は無効化されています' });
});

router.post('/trigger/strategy-meeting', auth, (_req, res) => {
  res.status(410).json({ ok: false, error: 'auto-meeting は無効化されています' });
});

router.post('/trigger/sync-rebrandly', auth, async (_req, res) => {
  try {
    const syncResult = await syncRebrandlyClicks();
    const posts = getPostsAfter(new Date(Date.now() - 30 * 86400000));
    const rbData = getRebrandlyData();
    const totalImp = posts.reduce((s: number, p: any) => s + (p.metrics?.impression_count ?? 0), 0);
    const totalClicks = rbData.links.reduce((s: number, l: any) => s + l.clicks, 0);
    const ctr = totalImp > 0 ? (totalClicks / totalImp * 100).toFixed(3) : '0.000';
    res.json({ ok: true, synced: syncResult?.synced ?? 0, totalLinks: rbData.links.length, totalClicks, ctr_pct: `${ctr}%` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/trigger/sheets-diagnose', auth, async (_req, res) => {
  try {
    const diag = await diagnoseSheetsConnection();
    res.json(diag);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/trigger/sheets-backfill', auth, async (_req, res) => {
  try {
    const strategy = getStrategySummary();
    const result = await backfillAllData({
      posts: getAllPosts().map((p: any) => ({
        tweetId: p.tweetId,
        tweetText: p.text,
        postedAt: p.postedAt,
        type: p.type,
        itemTitle: p.item?.title,
        metrics: p.metrics,
      })),
      directives: getDirectives().map((d) => ({
        id: d.id,
        text: d.text,
        category: d.category,
        priority: d.priority,
        status: d.status,
        source: d.source,
        createdAt: d.createdAt,
        autoExecuted: (d.executionLog?.length ?? 0) > 0,
      })),
      hypotheses: (strategy.hypotheses ?? []).map((h: any) => ({
        id: h.id,
        question: h.question,
        status: h.status,
        finding: h.finding,
        adjustment: h.adjustment,
        testedAt: h.testedAt,
      })),
    });
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/trigger/pause', auth, async (req, res) => {
  const reason = req.body?.reason ?? 'ダッシュボードから緊急停止';
  await pauseBot(reason);
  res.json({ ok: true, paused: true, reason });
});

router.post('/trigger/resume', auth, async (_req, res) => {
  await resumeBot();
  res.json({ ok: true, paused: false });
});

router.get('/trigger/pause-status', auth, (_req, res) => {
  res.json({ paused: isBotPaused(), reason: getPausedReason() });
});

export default router;
