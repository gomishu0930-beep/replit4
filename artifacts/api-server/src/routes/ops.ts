import { Router } from 'express';
import { getQueue, getQueueStats, getQueueItem, rejectQueueItem } from '../bot/post-queue.js';
import { getRunConfig } from '../bot/run-config.js';
import { getSafetyStatus } from '../bot/safety-engine.js';
import { getAllAnalytics, getAnalyticsStats } from '../bot/post-analytics.js';
import { getStats } from '../bot/storage.js';
import { checkTwitterApiAccess } from '../bot/twitter.js';
import { getSampleVideoStatus } from '../bot/sample-video.js';
import {
  loadAllowedMakersConfig,
  loadNgKeywordsConfig,
  saveAllowedMakersConfig,
  saveNgKeywordsConfig,
} from '../bot/ops-config.js';

const router = Router();

function envSet(name: string): boolean {
  return Boolean(process.env[name]);
}

function maskError(value: unknown): string {
  return String(value ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
    .replace(/(token|secret|key|api_id|affiliate_id)=([^&\s]+)/gi, '$1=***')
    .slice(0, 600);
}

function statusSummary() {
  const config = getRunConfig();
  return {
    postEnabled: config.autoPostEnabled,
    dryRun: config.dryRun,
    fanzaApiId: envSet('DMM_API_ID'),
    fanzaAffiliateId: envSet('DMM_AFFILIATE_ID'),
    xApiKey: envSet('TWITTER_API_KEY') || envSet('X_API_KEY'),
    xAccessToken: envSet('TWITTER_ACCESS_TOKEN') || envSet('X_ACCESS_TOKEN'),
    discord: envSet('DISCORD_BOT_TOKEN'),
    rebrandly: envSet('REBRANDLY_API_KEY'),
  };
}

router.get('/ops/dashboard', async (_req, res) => {
  const queue = getQueue();
  const stats = getQueueStats();
  const analytics = getAnalyticsStats(7);
  const safety = getSafetyStatus();
  const sampleVideo = await getSampleVideoStatus().catch((e: any) => ({ error: maskError(e.message), allowedMakers: [], ffmpegAvailable: false }));
  const x = await checkTwitterApiAccess().catch((e: any) => ({ ok: false, error: maskError(e.message) }));
  const sampleVideoCandidates = queue.filter((item) => item.mediaFiles?.some((m) => m.type?.includes('video'))).length;
  res.json({
    ok: true,
    status: statusSummary(),
    safety,
    queue: { stats, recent: queue.slice().reverse().slice(0, 8) },
    analytics,
    storageStats: getStats(),
    failures: queue.filter((item) => item.status === 'failed' || item.error).slice(-8).reverse(),
    exclusions: queue.filter((item) => item.status === 'rejected' || item.filterResult?.safe === false).slice(-8).reverse(),
    sampleVideoCandidates,
    integrations: {
      x,
      sampleVideo,
      fanza: { apiConfigured: envSet('DMM_API_ID'), affiliateConfigured: envSet('DMM_AFFILIATE_ID') },
    },
  });
});

router.get('/ops/settings/status', async (_req, res) => {
  const allowed = loadAllowedMakersConfig();
  const ng = loadNgKeywordsConfig();
  const config = getRunConfig();
  res.json({
    ok: true,
    secrets: statusSummary(),
    runtime: {
      POST_ENABLED: config.autoPostEnabled,
      DRY_RUN: config.dryRun,
      MAX_VIDEO_SECONDS: Number(process.env.SAMPLE_VIDEO_MAX_SECONDS ?? 8),
      VIDEO_WIDTH: 1280,
      VIDEO_HEIGHT: 720,
    },
    configCounts: {
      allowedMakers: allowed.makers.length,
      allowedVideoDomains: allowed.allowed_video_domains.length,
      ngKeywords: ng.keywords.length,
    },
  });
});

router.get('/ops/logs/posts', (_req, res) => {
  const analytics = getAllAnalytics();
  const queue = getQueue();
  res.json({
    ok: true,
    records: [
      ...analytics.map((row) => ({ ...row, source: 'analytics' })),
      ...queue.filter((item) => item.status === 'posted' || item.status === 'dry_run' || item.status === 'failed')
        .map((item) => ({
          source: 'queue',
          postId: item.tweetId ?? item.id,
          postedAt: item.postedAt ?? item.updatedAt,
          productId: item.agentProposalId ?? '',
          productTitle: item.itemTitle ?? item.type,
          category: item.type,
          text: item.text,
          url: item.affiliateUrl ?? '',
          result: item.status,
          error: item.error,
        })),
    ].slice(0, 300),
  });
});

router.get('/ops/logs/exclusions', (_req, res) => {
  const rows = getQueue()
    .filter((item) => item.status === 'rejected' || item.status === 'failed' || item.filterResult?.safe === false)
    .map((item) => ({
      id: item.id,
      content_id: item.agentProposalId ?? '',
      title: item.itemTitle ?? item.type,
      maker: '',
      reason: item.error ?? item.rejectionReason ?? item.filterResult?.reason ?? '除外/失敗',
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }))
    .reverse();
  const byReason = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.reason] = (acc[row.reason] ?? 0) + 1;
    return acc;
  }, {});
  res.json({ ok: true, rows, summary: { byReason } });
});

router.post('/ops/queue/:id/dry-run', async (req, res) => {
  const item = getQueueItem(req.params.id);
  if (!item) { res.status(404).json({ ok: false, error: 'キューアイテムが見つかりません' }); return; }
  const config = getRunConfig();
  res.json({
    ok: true,
    dryRun: true,
    canPost: config.autoPostEnabled && !config.dryRun && item.filterResult?.safe !== false,
    disabledReasons: [
      !config.autoPostEnabled ? 'POST_ENABLED=false' : '',
      config.dryRun ? 'DRY_RUN=true' : '',
      item.filterResult?.safe === false ? item.filterResult.reason ?? 'Compliance NG' : '',
    ].filter(Boolean),
    item,
    video: {
      hasVideo: Boolean(item.mediaFiles?.some((m) => m.type?.includes('video'))),
      files: item.mediaFiles ?? [],
    },
    compliance: item.filterResult ?? { safe: true },
  });
});

router.post('/ops/queue/:id/skip', (req, res) => {
  const item = rejectQueueItem(req.params.id, typeof req.body?.reason === 'string' ? req.body.reason : 'UI skip');
  if (!item) { res.status(404).json({ ok: false, error: 'キューアイテムが見つかりません' }); return; }
  res.json({ ok: true, item });
});

router.get('/ops/config/allowed-makers', (_req, res) => {
  res.json({ ok: true, config: loadAllowedMakersConfig() });
});

router.post('/ops/config/allowed-makers', (req, res) => {
  try {
    res.json({ ok: true, config: saveAllowedMakersConfig(req.body?.config ?? req.body) });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: maskError(e.message) });
  }
});

router.get('/ops/config/ng-keywords', (_req, res) => {
  res.json({ ok: true, config: loadNgKeywordsConfig() });
});

router.post('/ops/config/ng-keywords', (req, res) => {
  try {
    res.json({ ok: true, config: saveNgKeywordsConfig(req.body?.config ?? req.body) });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: maskError(e.message) });
  }
});

export default router;
