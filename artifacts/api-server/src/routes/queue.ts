/**
 * 投稿キュー管理APIルート
 * GET  /api/bot/queue              キュー一覧
 * POST /api/bot/queue/:id/approve  今すぐ投稿（manualDirect=trueでDiscord/ダッシュボード同等）
 * POST /api/bot/queue/:id/reject   却下
 * GET  /api/bot/queue/stats        統計
 */

import { Router } from 'express';
import {
  getQueue, getPendingQueue, rejectQueueItem,
  getQueueStats, getQueueItem,
} from '../bot/post-queue.js';
import { getRunConfig, updateRunConfig } from '../bot/run-config.js';
import { approveAndPostQueueItem } from '../bot/queue-publisher.js';

const router = Router();

router.get('/bot/queue', (_req, res) => {
  const status = (_req.query.status as string | undefined)?.split(',');
  const items = status
    ? getQueue(status as any)
    : getQueue();
  res.json({ ok: true, items: items.slice().reverse().slice(0, 50), stats: getQueueStats() });
});

router.get('/bot/queue/pending', (_req, res) => {
  res.json({ ok: true, items: getPendingQueue(), stats: getQueueStats() });
});

router.get('/bot/queue/stats', (_req, res) => {
  res.json({ ok: true, ...getQueueStats() });
});

router.get('/bot/queue/:id', (req, res) => {
  const item = getQueueItem(req.params.id);
  if (!item) { res.status(404).json({ error: 'キューアイテムが見つかりません' }); return; }
  res.json({ ok: true, item });
});

function truthy(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

router.post('/bot/queue/:id/approve', async (req, res) => {
  const manualDirect = truthy(req.body?.manualDirect) || truthy(req.query.manualDirect);
  const result = await approveAndPostQueueItem(req.params.id, {
    forceLive: manualDirect || truthy(req.body?.forceLive) || truthy(req.query.forceLive),
    bypassSafetyLimits: manualDirect || truthy(req.body?.bypassSafetyLimits) || truthy(req.query.bypassSafetyLimits),
    source: req.body?.source === 'dashboard' ? 'dashboard' : 'api',
  });
  if (!result.item) { res.status(404).json({ error: result.error ?? 'キューアイテムが見つかりません' }); return; }
  if (!result.ok) { res.status(400).json(result); return; }
  res.json(result);
});

router.post('/bot/queue/:id/reject', (req, res) => {
  const item = rejectQueueItem(req.params.id);
  if (!item) { res.status(404).json({ error: 'キューアイテムが見つかりません' }); return; }
  res.json({ ok: true, item });
});

router.get('/run-config', (_req, res) => {
  res.json({ ok: true, config: getRunConfig() });
});

router.patch('/run-config', (req, res) => {
  const allowed = [
    'autoPostEnabled', 'dryRun', 'maxPostsPerDay', 'maxPostsPerHour',
    'cooldownMinutes', 'safetyStrictness', 'discordNotifyEnabled', 'aiReviewEnabled',
    'categoryWeights',
  ];
  const partial: Record<string, any> = {};
  for (const key of allowed) {
    if (key in req.body) partial[key] = req.body[key];
  }
  updateRunConfig(partial);
  res.json({ ok: true, config: getRunConfig() });
});

export default router;
