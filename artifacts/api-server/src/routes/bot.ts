import { Router } from 'express';
import { getStats, getAllPosts } from '../bot/storage.js';

const router = Router();

router.get('/bot/status', (_req, res) => {
  const stats = getStats();
  res.json({
    status: 'running',
    uptime: Math.floor(process.uptime()),
    account: '@ero_senpai1',
    schedule: [
      { time: '12:00 JST', type: 'rank', label: 'ランキング' },
      { time: '15:00 JST', type: 'sale', label: 'セール' },
      { time: '18:00 JST', type: 'buzz', label: 'バズ + 指標更新' },
      { time: '21:00 JST', type: 'random', label: 'ランダム' },
      { time: '23:00 JST', type: 'sale', label: 'セール' },
    ],
    stats,
  });
});

router.get('/bot/posts', (_req, res) => {
  const posts = getAllPosts().slice(-30).reverse();
  res.json({ posts });
});

export default router;
