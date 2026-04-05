import { Router } from 'express';
import { getStats, getAllPosts, getExternalPatternsInfo, getDynamicTemplatesInfo } from '../bot/storage.js';
import { getMyUsername } from '../bot/twitter.js';
import { getStrategySummary } from '../bot/strategy.js';
import { getCampaignCacheInfo, discoverCampaignIds } from '../bot/fanza.js';
import { getWatchdogState } from '../bot/watchdog.js';

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

router.get('/bot/strategy', (_req, res) => {
  const summary = getStrategySummary();
  const dynInfo = getDynamicTemplatesInfo();
  res.json({ ...summary, dynamicTemplates: dynInfo });
});

// ウォッチドッグ状態
router.get('/bot/watchdog', (_req, res) => {
  res.json(getWatchdogState());
});

// DMM フロア一覧（利用可能なフロアの確認用）
router.get('/bot/floors', async (_req, res) => {
  try {
    const params = new URLSearchParams({
      api_id: process.env.DMM_API_ID ?? '',
      affiliate_id: process.env.DMM_AFFILIATE_ID ?? '',
      output: 'json',
    });
    const r = await fetch(`https://api.dmm.com/affiliate/v3/FloorList?${params}`);
    const data = await r.json() as any;
    const floors: { site: string; service: string; floorName: string; floorCode: string; floorId: string }[] = [];
    for (const site of data?.result?.site ?? []) {
      for (const svc of site.service ?? []) {
        for (const floor of svc.floor ?? []) {
          floors.push({
            site: site.name,
            service: svc.name,
            floorName: floor.name,
            floorCode: floor.code,
            floorId: floor.id,
          });
        }
      }
    }
    res.json({ total: floors.length, floors });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// キャンペーンID情報
router.get('/bot/campaign-ids', async (_req, res) => {
  try {
    const info = await getCampaignCacheInfo();
    res.json(info);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// キャンペーンID手動再探索（POST）
router.post('/bot/campaign-ids/discover', async (_req, res) => {
  try {
    // バックグラウンドで実行（レスポンスはすぐ返す）
    discoverCampaignIds({ force: true, maxProbe: 500 }).catch((e: any) =>
      console.warn('  ⚠ 手動探索失敗:', e.message),
    );
    res.json({ status: 'started', message: 'キャンペーンID探索を開始しました（バックグラウンド実行中）' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
