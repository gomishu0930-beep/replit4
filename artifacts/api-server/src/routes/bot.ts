import { Router } from 'express';
import { getStats, getAllPosts, getAccountSnapshots, recordAccountSnapshot, getObservations, addObservation, deleteObservation, ManualObservation, getRebrandlyData, recordPostManual } from '../bot/storage.js';
import { autoCreateRebrandlyLinks, getRebrandlyStatus, resolveShortUrl, syncRebrandlyClicks } from '../bot/rebrandly.js';
import { getMyUsername, getAccountInfo, getTweetById, getOwnRecentTweets, uploadImages, postTweet, replyToTweet } from '../bot/twitter.js';
import { generateImage, getImageGenStatus, type ImageEngine } from '../bot/imageGen.js';
import { scoreImage, generateAndScore, generateUntilPass } from '../bot/imageScorer.js';
import { getStrategySummary } from '../bot/strategy.js';
import { getCampaignCacheInfo, discoverCampaignIds, fetchItems, getAmateurItems, getBuzzItems, getRankingItems, getSaleItems, getRandomItems, getKeywordItems, getRevenueOptimizedItems, getSampleImages, scoreFanzaItem } from '../bot/fanza.js';
import { getWatchdogState } from '../bot/watchdog.js';
import { getSafetyStatus, validatePost, recordPostEvent, updateFollowerCount } from '../bot/safety-engine.js';
import { generateTweetText, generateEroticStoryTweet } from '../bot/ai.js';
import { researchBuzzForItem } from '../bot/grok.js';
import { enqueuePost, getQueue } from '../bot/post-queue.js';
import { filterContent } from '../bot/content-filter.js';
import { getRunConfig } from '../bot/run-config.js';
import { pickFanzaTemplate, strengthenFanzaPostText } from '../bot/fanza-templates.js';
import { recordAnalytics } from '../bot/post-analytics.js';
import {
  checkSampleVideoPermission,
  extractSampleMovieUrl,
  getFanzaMakerNames,
  getSampleVideoFilePath,
  getSampleVideoStatus,
  prepareSampleVideoClip,
} from '../bot/sample-video.js';
import { getEmailNotifyStatus, sendEmailNotification } from '../bot/email-notifier.js';

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
  res.json({ ...getRebrandlyData(), status: getRebrandlyStatus() });
});

router.get('/bot/sample-video/status', async (_req, res) => {
  res.json({
    ok: true,
    sampleVideo: await getSampleVideoStatus(),
    email: getEmailNotifyStatus(),
  });
});

router.get('/bot/media/:filename', (req, res) => {
  const filePath = getSampleVideoFilePath(req.params.filename);
  if (!filePath) {
    res.status(404).json({ error: 'メディアが見つかりません' });
    return;
  }
  res.type('video/mp4').sendFile(filePath);
});

function normalizeFanzaItem(rawItem: any): any {
  return {
    ...rawItem,
    title: rawItem?.title ?? '',
    content_id: rawItem?.content_id ?? rawItem?.id ?? '',
    affiliateURL: rawItem?.affiliateURL ?? rawItem?.affiliateUrl ?? '',
    review: rawItem?.review ?? { count: rawItem?.reviewCount ?? 0, average: rawItem?.reviewAvg ?? '4.0' },
    iteminfo: {
      ...(rawItem?.iteminfo ?? {}),
      actress: rawItem?.iteminfo?.actress ?? (Array.isArray(rawItem?.actress) ? rawItem.actress.map((name: string) => ({ name })) : []),
      genre: rawItem?.iteminfo?.genre ?? (Array.isArray(rawItem?.genre) ? rawItem.genre.map((name: string) => ({ name })) : []),
      maker: rawItem?.iteminfo?.maker ?? (Array.isArray(rawItem?.makers) ? rawItem.makers.map((name: string) => ({ name })) : []),
    },
    sampleMovieURL: rawItem?.sampleMovieURL ?? rawItem?.sampleMovieUrl,
  };
}

router.post('/bot/sample-video/queue', requireAdminToken, async (req, res) => {
  const rawItem = req.body?.item;
  if (!rawItem?.title) {
    res.status(400).json({ error: 'item.title が必要です' });
    return;
  }

  try {
    const item = normalizeFanzaItem(rawItem);
    const permission = checkSampleVideoPermission(item);
    if (!permission.allowed) {
      res.status(400).json({ error: permission.reason, permission });
      return;
    }

    const text = String(req.body?.text ?? '').trim() || pickFanzaTemplate(item, 'revenue').text;
    const filterResult = filterContent(text, getRunConfig().safetyStrictness);
    if (!filterResult.safe) {
      res.status(400).json({ error: filterResult.reason ?? 'コンテンツフィルターで除外', filterResult });
      return;
    }

    const clip = await prepareSampleVideoClip(item, {
      startSec: Number(req.body?.startSec ?? 3),
      durationSec: Number(req.body?.durationSec ?? 8),
    });
    const sourceUrl = item.content_id ?? item.id;
    const queueItem = enqueuePost({
      type: 'fanza',
      text,
      itemTitle: item.title,
      affiliateUrl: item.affiliateURL ?? undefined,
      sourceUrl,
      mediaFiles: [{ filename: clip.filename, url: clip.url, type: 'video/mp4' }],
      filterResult,
      safetyScore: Math.max(0, 100 - (filterResult.blockedWords?.length ?? 0) * 20),
    });

    recordAnalytics({
      postId: queueItem.id,
      postedAt: queueItem.createdAt,
      provider: 'twitter',
      productId: sourceUrl ?? '',
      productTitle: item.title ?? '',
      category: 'fanza',
      templateType: 'sample-video',
      templateCategory: 'other',
      text,
      url: item.affiliateURL ?? '',
      shortUrl: '',
      imageUsed: true,
      safetyScore: queueItem.safetyScore ?? 100,
      result: 'queued',
      clicks: 0,
      impressions: 0,
      likes: 0,
      reposts: 0,
      replies: 0,
      metricsUpdatedAt: null,
    });

    const notifyTo = String(req.body?.notifyEmail || process.env.SAMPLE_VIDEO_NOTIFY_EMAIL || '').trim();
    const email = notifyTo
      ? await sendEmailNotification({
        to: notifyTo,
        subject: 'FANZAサンプル動画キュー作成完了',
        text: `サンプル動画付き投稿をキューに追加しました。\n\n作品: ${item.title}\nqueue_id: ${queueItem.id}\n動画: ${clip.url}`,
      })
      : { ok: false, skipped: true, error: '通知先未指定' };

    res.json({ ok: true, queueItem, clip, permission, email });
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? String(e) });
  }
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

router.post('/bot/rebrandly/auto-create', async (req, res) => {
  try {
    if (!process.env.REBRANDLY_API_KEY) {
      res.status(400).json({ error: 'REBRANDLY_API_KEY が設定されていません' });
      return;
    }

    const bodyCandidates = Array.isArray(req.body?.candidates) ? req.body.candidates : [];
    const queueCandidates = getQueue(['pending', 'approved'])
      .filter(item => item.affiliateUrl)
      .map(item => ({
        affiliateUrl: item.affiliateUrl,
        itemId: item.sourceUrl ?? item.id,
        title: item.itemTitle ?? item.type,
      }));

    const result = await autoCreateRebrandlyLinks([...queueCandidates, ...bodyCandidates]);
    const syncResult = await syncRebrandlyClicks().catch(() => null);
    res.json({ ok: true, ...result, synced: syncResult?.synced ?? 0, status: getRebrandlyStatus() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/bot/nanobanana/generate', async (req, res) => {
  const { prompt, referenceImageUrls, safetyTolerance, engine } = req.body ?? {};
  if (!prompt?.trim()) { res.status(400).json({ error: 'prompt は必須です' }); return; }
  try {
    const validEngines = ['auto', 'fal', 'nanobanana', 'dalle'];
    const selectedEngine: ImageEngine = validEngines.includes(engine) ? engine : 'auto';
    const imageUrl = await generateImage(prompt.trim(), {
      referenceImageUrls: referenceImageUrls ?? undefined,
      safetyTolerance: safetyTolerance ?? 4,
      engine: selectedEngine,
    });
    res.json({ ok: true, imageUrl, engine: selectedEngine });
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

router.get('/bot/erotic-story/draft', (_req, res) => {
  const draft = generateEroticStoryTweet();
  res.json({ ok: true, text: draft.text, imagePrompt: draft.imagePrompt });
});

router.post('/bot/erotic-story/post', requireAdminToken, async (req, res) => {
  const { text, imageUrl } = req.body ?? {};
  if (!text?.trim()) { res.status(400).json({ error: 'text は必須です' }); return; }
  try {
    let mediaIds: string[] = [];
    if (imageUrl?.trim()) {
      mediaIds = await uploadImages([imageUrl.trim()]);
    }
    const tweetId = await postTweet(text.trim(), mediaIds);
    recordPostEvent(false);
    res.json({ ok: true, tweetId });
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
      case 'revenue': items = await getRevenueOptimizedItems(count, keyword || undefined); break;
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
      sampleMovieUrl: extractSampleMovieUrl(item),
      makers: getFanzaMakerNames(item),
      sampleVideoAllowed: checkSampleVideoPermission(item),
      price: item.prices?.price ?? null,
      date: item.date ?? null,
      revenueScore: item.revenueScore ?? scoreFanzaItem(item),
    }));
    res.json({ ok: true, items: mapped });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/bot/fanza-revenue-queue', requireAdminToken, async (req, res) => {
  const count = Math.min(Math.max(Number(req.body?.count) || 3, 1), 10);
  const keyword = String(req.body?.keyword || '').trim();
  const withImage = req.body?.withImage !== false;

  try {
    const items = await getRevenueOptimizedItems(count, keyword || undefined);
    const activeSourceUrls = new Set(
      getQueue(['pending', 'approved'])
        .filter((queueItem) => queueItem.type === 'fanza' && queueItem.sourceUrl)
        .map((queueItem) => queueItem.sourceUrl),
    );
    const queued = [];
    const rebrandlyCandidates: Array<{ affiliateUrl?: string; itemId?: string; title?: string }> = [];

    for (const item of items) {
      const sourceUrl = item.content_id ?? item.id;
      if (sourceUrl && activeSourceUrls.has(sourceUrl)) {
        queued.push({
          ok: false,
          content_id: item.content_id,
          title: item.title,
          error: '既にキューにあります',
        });
        continue;
      }

      const tmpl = pickFanzaTemplate(item, 'revenue');
      const filterResult = filterContent(tmpl.text, getRunConfig().safetyStrictness);
      if (!filterResult.safe) {
        queued.push({
          ok: false,
          content_id: item.content_id,
          title: item.title,
          error: filterResult.reason ?? 'コンテンツフィルターで除外',
        });
        continue;
      }

      const safetyScore = Math.max(0, 100 - (filterResult.blockedWords?.length ?? 0) * 20);
      const imageUrl = withImage ? getSampleImages(item)[0] ?? undefined : undefined;
      const queueItem = enqueuePost({
        type: 'fanza',
        text: tmpl.text,
        itemTitle: item.title,
        affiliateUrl: item.affiliateURL ?? undefined,
        imageUrl,
        sourceUrl,
        templateType: tmpl.templateType,
        templateCategory: tmpl.templateCategory,
        safetyScore,
        filterResult,
      });

      recordAnalytics({
        postId: queueItem.id,
        postedAt: queueItem.createdAt,
        provider: 'twitter',
        productId: item.content_id ?? item.id ?? '',
        productTitle: item.title ?? '',
        category: 'fanza',
        templateType: tmpl.templateType,
        templateCategory: tmpl.templateCategory,
        text: tmpl.text,
        url: item.affiliateURL ?? '',
        shortUrl: '',
        imageUsed: Boolean(imageUrl),
        safetyScore,
        result: 'queued',
        clicks: 0,
        impressions: 0,
        likes: 0,
        reposts: 0,
        replies: 0,
        metricsUpdatedAt: null,
      });

      queued.push({
        ok: true,
        queueId: queueItem.id,
        content_id: item.content_id,
        title: item.title,
        revenueScore: item.revenueScore ?? scoreFanzaItem(item),
        templateCategory: tmpl.templateCategory,
      });
      rebrandlyCandidates.push({ affiliateUrl: item.affiliateURL, itemId: sourceUrl, title: item.title });
      if (sourceUrl) activeSourceUrls.add(sourceUrl);
    }

    const rebrandly = process.env.REBRANDLY_API_KEY
      ? await autoCreateRebrandlyLinks(rebrandlyCandidates)
      : null;

    res.json({ ok: true, requested: count, queuedCount: queued.filter(i => i.ok).length, items: queued, rebrandly });
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
    const strengthened = strengthenFanzaPostText(result.text, item, tweetType === 'sale' ? 'sale' : 'review');

    res.json({
      ok: true,
      tweet: strengthened.text,
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
