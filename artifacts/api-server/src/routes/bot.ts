import { Router } from 'express';
import { getStats, getAllPosts, getAccountSnapshots, recordAccountSnapshot, getObservations, addObservation, deleteObservation, ManualObservation, getRebrandlyData, recordPostManual } from '../bot/storage.js';
import { syncRebrandlyClicks } from '../bot/rebrandly.js';
import { getMyUsername, getAccountInfo, getTweetById, getOwnRecentTweets, uploadImages, postTweet, replyToTweet } from '../bot/twitter.js';
import { generateImage, getImageGenStatus } from '../bot/imageGen.js';
import { scoreImage, generateAndScore, generateUntilPass } from '../bot/imageScorer.js';
import { getStrategySummary } from '../bot/strategy.js';
import { getCampaignCacheInfo, discoverCampaignIds, fetchItems, getAmateurItems, getBuzzItems, getRankingItems, getSaleItems, getRandomItems, getKeywordItems, getSampleImages } from '../bot/fanza.js';
import { getWatchdogState } from '../bot/watchdog.js';
import { getSafetyStatus, validatePost, recordPostEvent, updateFollowerCount } from '../bot/safety-engine.js';
import { generateTweetText } from '../bot/ai.js';
import { resolveShortUrl } from '../bot/rebrandly.js';
import { researchBuzzForItem } from '../bot/grok.js';

const router = Router();

function requireAdminToken(req: any, res: any, next: any) {
  const token = req.headers['x-admin-token'] as string | undefined;
  const secret = process.env.SESSION_SECRET;
  if (secret && token && token === secret) { return next(); }
  const origin = req.headers.origin as string | undefined;
  const referer = req.headers.referer as string | undefined;
  const allowedDomains = [
    process.env.REPLIT_DEV_DOMAIN,
    process.env.REPLIT_DEPLOYMENT_DOMAIN,
    process.env.REPLIT_DOMAINS,
  ].filter(Boolean);
  if (allowedDomains.length > 0) {
    const checkUrl = origin || referer || '';
    try {
      const host = new URL(checkUrl).hostname;
      if (allowedDomains.some(d => host === d || host.endsWith('.' + d) || host.endsWith('.replit.app'))) {
        return next();
      }
    } catch {
      if (allowedDomains.some(d => checkUrl.includes(d!)) || checkUrl.includes('.replit.app')) {
        return next();
      }
    }
  }
  if (process.env.NODE_ENV === 'development') { return next(); }
  res.status(401).json({ error: '認証が必要です' });
}

router.get('/bot/status', async (_req, res) => {
  const stats = getStats();
  const account = await getMyUsername();
  const safety = getSafetyStatus();

  res.json({
    status: 'running',
    uptime: Math.floor(process.uptime()),
    account,
    mode: safety.automationLevel,
    safety: {
      level: safety.automationLevel,
      riskScore: safety.riskScore,
      dailyPostLimit: safety.dailyPostLimit,
      todayPostCount: safety.todayPostCount,
      remainingPostsToday: safety.remainingPostsToday,
      affiliateRatio: safety.currentAffiliateRatio,
      followerCount: safety.followerCount,
      accountAgeDays: safety.accountAgeDays,
    },
    imageGen: getImageGenStatus(),
    stats,
  });
});

router.get('/bot/posts', (_req, res) => {
  const posts = getAllPosts().slice(-50).reverse();
  res.json({ posts });
});

router.post('/bot/posts/sync-timeline', async (_req, res) => {
  try {
    const tweets = await getOwnRecentTweets(50);
    let newCount = 0;
    let updatedCount = 0;
    for (const t of tweets) {
      const metrics = t.public_metrics ?? null;
      const { isNew } = recordPostManual({
        tweetId: t.id,
        text: t.text,
        postedAt: (t as any).created_at ?? new Date().toISOString(),
        metrics: metrics as any,
      });
      if (isNew) newCount++; else updatedCount++;
    }

    let followerCount: number | null = null;
    try {
      const info = await getAccountInfo();
      if (info) {
        updateFollowerCount(info.followersCount);
        followerCount = info.followersCount;
      }
    } catch (e: any) {
      console.warn('  ⚠ フォロワー数自動取得失敗:', e.message);
    }

    return res.json({ success: true, total: tweets.length, newCount, updatedCount, followerCount });
  } catch (e: any) {
    return res.status(500).json({ error: e.message ?? 'タイムライン取得失敗' });
  }
});

router.post('/bot/posts/register-manual', async (req, res) => {
  const { tweetId } = req.body as { tweetId?: string };
  if (!tweetId || !/^\d+$/.test(tweetId.trim())) {
    return res.status(400).json({ error: 'tweetId (数字) が必要です' });
  }
  const id = tweetId.trim();
  const tweet = await getTweetById(id);
  if (!tweet) {
    return res.status(404).json({ error: 'ツイートが見つかりません' });
  }
  const { isNew, post } = recordPostManual({
    tweetId: tweet.id,
    text: tweet.text,
    postedAt: tweet.createdAt,
    metrics: tweet.metrics,
  });
  return res.json({ success: true, isNew, post });
});

router.get('/bot/strategy', (_req, res) => {
  const summary = getStrategySummary();
  res.json(summary);
});

router.get('/bot/watchdog', (_req, res) => {
  res.json(getWatchdogState());
});

router.get('/bot/floors', async (_req, res) => {
  try {
    const params = new URLSearchParams({
      api_id: process.env.DMM_API_ID ?? '',
      affiliate_id: process.env.DMM_AFFILIATE_ID ?? '',
      output: 'json',
    });
    const r = await fetch(`https://api.dmm.com/affiliate/v3/FloorList?${params}`);
    const data = await r.json() as any;
    const floors: any[] = [];
    for (const site of data?.result?.site ?? []) {
      for (const svc of site.service ?? []) {
        for (const floor of svc.floor ?? []) {
          floors.push({ site: site.name, service: svc.name, floorName: floor.name, floorCode: floor.code, floorId: floor.id });
        }
      }
    }
    res.json({ total: floors.length, floors });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/bot/campaign-ids', async (_req, res) => {
  try {
    const info = await getCampaignCacheInfo();
    res.json(info);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/bot/api-check', async (_req, res) => {
  const results: Record<string, { ok: boolean; detail: string }> = {};
  try {
    const info = await getAccountInfo();
    results['GET /v2/users/me'] = info
      ? { ok: true, detail: `@${info.username} / フォロワー ${info.followersCount}人` }
      : { ok: false, detail: '取得失敗' };
  } catch (e: any) {
    results['GET /v2/users/me'] = { ok: false, detail: e.message };
  }
  res.json({ results });
});

router.get('/bot/snapshots', (_req, res) => {
  res.json({ snapshots: getAccountSnapshots() });
});

router.post('/bot/snapshots/capture', async (_req, res) => {
  try {
    const info = await getAccountInfo();
    if (!info) { res.status(503).json({ ok: false, error: 'Twitter API取得失敗' }); return; }
    const note = (_req.body?.note as string) ?? '手動記録';
    recordAccountSnapshot({ ...info, note });
    res.json({ ok: true, snapshot: { ...info, note } });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/bot/observations', (req, res) => {
  const cat = req.query.category as ManualObservation['category'] | undefined;
  res.json({ observations: getObservations(cat) });
});

router.post('/bot/observations', (req, res) => {
  const { category, observation, source, hypothesis, priority } = req.body ?? {};
  if (!category || !observation) {
    res.status(400).json({ ok: false, error: 'category と observation は必須です' });
    return;
  }
  const obs = addObservation({ category, observation, source, hypothesis, priority: priority ?? 'medium' });
  res.json({ ok: true, observation: obs });
});

router.delete('/bot/observations/:id', (req, res) => {
  const deleted = deleteObservation(req.params.id);
  if (!deleted) { res.status(404).json({ ok: false, error: '該当なし' }); return; }
  res.json({ ok: true });
});

router.get('/bot/rebrandly', (_req, res) => {
  res.json(getRebrandlyData());
});

router.post('/bot/rebrandly/sync', async (_req, res) => {
  try {
    const result = await syncRebrandlyClicks();
    if (result === null) {
      res.status(400).json({ error: 'REBRANDLY_API_KEY が設定されていません' });
    } else {
      res.json({ ok: true, synced: result.synced, totalClicks: result.totalClicks });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/bot/nanobanana/generate', async (req, res) => {
  const { prompt, referenceImageUrls, safetyTolerance, forceDalle } = req.body ?? {};
  if (!prompt?.trim()) { res.status(400).json({ error: 'prompt は必須です' }); return; }
  try {
    const imageUrl = await generateImage(prompt.trim(), {
      referenceImageUrls: referenceImageUrls ?? undefined,
      safetyTolerance: safetyTolerance ?? 4,
      forceDalle: !!forceDalle,
    });
    res.json({ ok: true, imageUrl, engine: forceDalle ? 'dall-e-3' : 'auto' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/bot/nanobanana/upload', async (req, res) => {
  const { imageUrl } = req.body ?? {};
  if (!imageUrl?.trim()) { res.status(400).json({ error: 'imageUrl は必須です' }); return; }
  try {
    const mediaIds = await uploadImages([imageUrl.trim()]);
    res.json({ ok: true, mediaId: mediaIds[0] ?? null, mediaIds });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/bot/tweet', requireAdminToken, async (req, res) => {
  const { text, mediaIds = [], isAffiliate = false } = req.body ?? {};
  if (!text?.trim()) { res.status(400).json({ error: 'text は必須です' }); return; }

  const validation = validatePost(isAffiliate);
  if (!validation.allowed) {
    res.status(429).json({ error: '安全制限', validation });
    return;
  }

  try {
    const tweetId = await postTweet(text.trim(), mediaIds);
    recordPostEvent(isAffiliate);
    res.json({ ok: true, tweetId, validation });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/bot/image/score', async (req, res) => {
  const { imageUrl } = req.body ?? {};
  if (!imageUrl?.trim()) { res.status(400).json({ error: 'imageUrl は必須です' }); return; }
  try {
    const result = await scoreImage(imageUrl.trim());
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/bot/image/generate-and-score', async (req, res) => {
  const { prompt } = req.body ?? {};
  if (!prompt?.trim()) { res.status(400).json({ error: 'prompt は必須です' }); return; }
  try {
    const result = await generateAndScore(prompt.trim());
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/bot/image/generate-until-pass', async (req, res) => {
  const { prompt, maxAttempts = 3, minScore = 85 } = req.body ?? {};
  if (!prompt?.trim()) { res.status(400).json({ error: 'prompt は必須です' }); return; }
  try {
    const result = await generateUntilPass(prompt.trim(), maxAttempts, minScore);
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/bot/reply', requireAdminToken, async (req, res) => {
  const { tweetId, text } = req.body ?? {};
  if (!tweetId?.trim() || !text?.trim()) { res.status(400).json({ error: 'tweetId と text は必須です' }); return; }
  try {
    const replyId = await replyToTweet(tweetId.trim(), text.trim());
    res.json({ ok: true, tweetId: replyId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/bot/fanza-search', requireAdminToken, async (req, res) => {
  const type = String(req.query.type || 'rank');
  const keyword = String(req.query.keyword || '').trim();
  const count = Math.min(Number(req.query.count) || 10, 30);
  try {
    let items: any[] = [];
    switch (type) {
      case 'amateur': items = await getAmateurItems(count); break;
      case 'buzz': items = await getBuzzItems(count); break;
      case 'rank': items = await getRankingItems(count); break;
      case 'sale': items = await getSaleItems(count); break;
      case 'random': items = await getRandomItems(count); break;
      case 'keyword':
        if (!keyword) { res.status(400).json({ error: 'キーワードを指定してください' }); return; }
        items = await getKeywordItems(keyword, count);
        break;
      default:
        items = await getRankingItems(count);
    }
    const mapped = items.map((item: any) => ({
      content_id: item.content_id,
      title: item.title,
      affiliateURL: item.affiliateURL,
      actress: item.iteminfo?.actress?.map((a: any) => a.name) ?? [],
      genre: item.iteminfo?.genre?.map((g: any) => g.name)?.slice(0, 5) ?? [],
      reviewCount: item.review?.count ?? 0,
      reviewAvg: item.review?.average ?? null,
      thumbnail: item.imageURL?.large ?? item.imageURL?.small ?? null,
      sampleImages: getSampleImages(item),
      price: item.prices?.price ?? null,
      date: item.date ?? null,
    }));
    res.json({ ok: true, items: mapped });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/bot/generate-tweet', requireAdminToken, async (req, res) => {
  const { item: rawItem, type = 'amateur', shortenLink = true } = req.body ?? {};
  if (!rawItem?.title?.trim()) { res.status(400).json({ error: '作品情報（title）は必須です' }); return; }
  try {
    const item = {
      title: rawItem.title.trim(),
      content_id: rawItem.content_id || '',
      actress: Array.isArray(rawItem.actress)
        ? rawItem.actress.map((a: string) => ({ name: a }))
        : rawItem.actress ? [{ name: rawItem.actress }] : [],
      review: { count: rawItem.reviewCount ?? 0, average: rawItem.reviewAvg ?? '4.5' },
      affiliateURL: rawItem.affiliateURL || '',
      genre: Array.isArray(rawItem.genre) ? rawItem.genre : [],
    };
    const tweetType = type === 'keyword' ? 'random' : type;

    const [grokResearch, shortUrlResult] = await Promise.all([
      Promise.race([
        researchBuzzForItem(item.title, item.genre),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Grok timeout 30s')), 30000)),
      ]).catch((e: any) => {
        console.warn('  ⚠ Grok市場調査失敗（Claudeのみで生成）:', e.message);
        return '';
      }),
      (async () => {
        if (item.affiliateURL && shortenLink) {
          try {
            return await resolveShortUrl(item.affiliateURL, item.content_id, item.title);
          } catch (e: any) {
            console.warn('短縮URL生成失敗:', e.message);
            return item.affiliateURL;
          }
        }
        return item.affiliateURL || '';
      })(),
    ]);

    const result = await generateTweetText(item, tweetType, [], [], grokResearch || undefined);

    res.json({
      ok: true,
      tweet: result.text,
      imagePrompt: result.imagePrompt,
      affiliateURL: item.affiliateURL,
      shortUrl: shortUrlResult,
      grokResearch: grokResearch ? true : false,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
