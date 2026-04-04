import { Router } from 'express';
import { getStats, getAllPosts, getExternalPatternsInfo } from '../bot/storage.js';
import { getMyUsername } from '../bot/twitter.js';

const router = Router();

router.get('/bot/status', async (_req, res) => {
  const stats = getStats();
  const account = await getMyUsername();

  res.json({
    status: 'running',
    uptime: Math.floor(process.uptime()),
    account,
    schedule: [
      { time: '09:00 JST', type: 'amateur', label: '素人' },
      { time: '12:00 JST', type: 'buzz',   label: '高評価（4.7点以上）' },
      { time: '18:00 JST', type: 'buzz',   label: 'バズ + 指標更新' },
      { time: '21:00 JST', type: 'random', label: 'ランダム' },
      { time: '23:00 JST', type: 'sale',   label: 'セール' },
    ],
    stats,
  });
});

router.get('/bot/posts', (_req, res) => {
  const posts = getAllPosts().slice(-30).reverse();
  res.json({ posts });
});

router.get('/bot/external-patterns', (_req, res) => {
  const info = getExternalPatternsInfo();
  res.json(info);
});

export default router;
