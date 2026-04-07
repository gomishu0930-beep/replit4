import { Router } from 'express';
import { getStats, getAllPosts, getExternalPatternsInfo, getDynamicTemplatesInfo, getAccountSnapshots, recordAccountSnapshot, getObservations, addObservation, deleteObservation, ManualObservation, getManualFeedbacks, recordManualFeedback, getRebrandlyData, getAlgoInsights, getLatestAlgoInsight, getAlgoDiscoveries, updateAlgoDiscoveryStatus, getAlgoDiscoveryMeta } from '../bot/storage.js';
import { buildManualPostFeedback } from '../bot/ai.js';
import { syncRebrandlyClicks } from '../bot/rebrandly.js';
import { runAlgoAnalysis, computeAlgoStats, X_ALGO_KB } from '../bot/algo.js';
import { collectAlgoNews } from '../bot/algo-news.js';
import { getMyUsername, getAccountInfo } from '../bot/twitter.js';
import { getStrategySummary } from '../bot/strategy.js';
import { getCampaignCacheInfo, discoverCampaignIds } from '../bot/fanza.js';
import { getWatchdogState } from '../bot/watchdog.js';
import { runAutoDirectiveExecution, runABTestDecision, AUTONOMY_GRANTED_AT } from '../bot/auto-execute.js';

const router = Router();

router.get('/bot/status', async (_req, res) => {
  const stats = getStats();
  const account = await getMyUsername();

  res.json({
    status: 'running',
    uptime: Math.floor(process.uptime()),
    account,
    mode: 'recovery',
    schedule: [
      { time: '10:30 JST', type: 'impression', label: '💬 インプ狙い（リンクなし）' },
      { time: '20:00 JST', type: 'celebrity',  label: '🎭 芸能人アフィリ（動的時間帯）' },
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

// ─── Twitter API 疎通診断 ────────────────────────────────────────────────────
// どのエンドポイントが現在のプランで動くかを確認する

router.get('/bot/api-check', async (_req, res) => {
  const results: Record<string, { ok: boolean; detail: string }> = {};

  // ① /v2/users/me（認証ユーザー情報 — 通常 Basic+ で動作）
  try {
    const info = await getAccountInfo();
    results['GET /v2/users/me'] = info
      ? { ok: true, detail: `@${info.username} / フォロワー ${info.followersCount}人` }
      : { ok: false, detail: '取得失敗' };
  } catch (e: any) {
    results['GET /v2/users/me'] = { ok: false, detail: e.message };
  }

  // ② 自ツイート取得（フリープランでは 402）
  try {
    const { getOwnRecentTweets } = await import('../bot/twitter.js');
    const tweets = await getOwnRecentTweets(5);
    results['GET /v2/users/:id/tweets'] = { ok: true, detail: `${tweets.length}件取得成功` };
  } catch (e: any) {
    results['GET /v2/users/:id/tweets'] = { ok: false, detail: e.message.slice(0, 80) };
  }

  // ③ ツイート検索（フリープランでは 402）
  try {
    const { searchTweetsByHashtag } = await import('../bot/twitter.js');
    const tweets = await searchTweetsByHashtag('FANZA', 10);
    results['GET /v2/tweets/search/recent'] = { ok: true, detail: `${tweets.length}件取得成功` };
  } catch (e: any) {
    results['GET /v2/tweets/search/recent'] = { ok: false, detail: e.message.slice(0, 80) };
  }

  const allOk = Object.values(results).every((r) => r.ok);
  res.json({
    summary: allOk ? '✅ 全エンドポイント動作中' : '⚠️ 一部エンドポイントが利用不可',
    results,
  });
});

// ─── 回復研究: アカウントスナップショット ─────────────────────────────────────

// フォロワー推移一覧
router.get('/bot/snapshots', (_req, res) => {
  res.json({ snapshots: getAccountSnapshots() });
});

// 手動でスナップショットを今すぐ取得
router.post('/bot/snapshots/capture', async (_req, res) => {
  try {
    const info = await getAccountInfo();
    if (!info) {
      res.status(503).json({ ok: false, error: 'Twitter API からアカウント情報を取得できませんでした' });
      return;
    }
    const note = (_req.body?.note as string) ?? '手動記録';
    recordAccountSnapshot({ ...info, note });
    res.json({ ok: true, snapshot: { ...info, note } });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── 回復研究: 手動観察ログ ────────────────────────────────────────────────────

// 観察ログ一覧（?category=engagement|product|safe-post|other）
router.get('/bot/observations', (req, res) => {
  const cat = req.query.category as ManualObservation['category'] | undefined;
  res.json({ observations: getObservations(cat) });
});

// 観察を追加
router.post('/bot/observations', (req, res) => {
  const { category, observation, source, hypothesis, priority } = req.body ?? {};
  if (!category || !observation) {
    res.status(400).json({ ok: false, error: 'category と observation は必須です' });
    return;
  }
  const validCategories = ['engagement', 'product', 'safe-post', 'other'];
  if (!validCategories.includes(category)) {
    res.status(400).json({ ok: false, error: `category は ${validCategories.join('|')} のいずれかです` });
    return;
  }
  const obs = addObservation({
    category,
    observation,
    source: source ?? undefined,
    hypothesis: hypothesis ?? undefined,
    priority: priority ?? 'medium',
  });
  res.json({ ok: true, observation: obs });
});

// 観察を削除
router.delete('/bot/observations/:id', (req, res) => {
  const deleted = deleteObservation(req.params.id);
  if (!deleted) {
    res.status(404).json({ ok: false, error: '該当する観察ログが見つかりません' });
    return;
  }
  res.json({ ok: true });
});

// 手動投稿フィードバック履歴取得
router.get('/bot/manual-feedback', (_req, res) => {
  res.json({ feedbacks: getManualFeedbacks(10) });
});

// 手動投稿フィードバック即時生成（手動トリガー）
router.post('/bot/manual-feedback/run', async (_req, res) => {
  try {
    const fb = await buildManualPostFeedback(7);
    if (!fb) {
      return res.json({ ok: false, reason: '直近7日間の手動投稿が見つかりませんでした' });
    }
    const saved = recordManualFeedback(fb);
    res.json({ ok: true, feedback: saved });
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

// ─── アルゴリズム解析 ──────────────────────────────────────────────────────────

router.get('/bot/algo-kb', (_req, res) => {
  res.json(X_ALGO_KB);
});

// アルゴ発見情報 CRUD
router.get('/bot/algo-discoveries', (_req, res) => {
  res.json({
    meta: getAlgoDiscoveryMeta(),
    discoveries: getAlgoDiscoveries(),
  });
});

router.post('/bot/algo-discoveries/search', async (_req, res) => {
  try {
    const found = await collectAlgoNews();
    res.json({ ok: true, found: found.length, discoveries: found });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/bot/algo-discoveries/:id', (req, res) => {
  const { status, note } = req.body as { status: string; note?: string };
  const validStatuses = ['pending', 'adopted', 'rejected'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'invalid status' });
  }
  const ok = updateAlgoDiscoveryStatus(req.params.id, status as any, note);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

router.get('/bot/algo-insights', (_req, res) => {
  const latest = getLatestAlgoInsight();
  const stats  = computeAlgoStats();
  res.json({ latest, stats: { byType: stats.byType, byHour: stats.byHour, byDayOfWeek: stats.byDayOfWeek, correlations: stats.correlations, topPosts: stats.topPosts, sampleSize: stats.sampleSize } });
});

router.post('/bot/algo-insights/run', async (_req, res) => {
  try {
    const insight = await runAlgoAnalysis();
    res.json({ ok: true, briefing: insight.briefing, generatedAt: insight.generatedAt });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Rebrandly ────────────────────────────────────────────────────────────────

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

// ─── 自律実行エンドポイント ──────────────────────────────────────────────────

router.get('/bot/autonomy/status', (_req, res) => {
  res.json({
    autonomyGrantedAt: AUTONOMY_GRANTED_AT,
    isAutonomous: true,
    features: [
      { key: 'directive_auto_exec', label: '会議室決定事項の自動実行', schedule: '毎朝 07:30 JST', enabled: true },
      { key: 'algo_auto_apply',    label: 'アルゴ推奨の自動戦略適用', schedule: '日曜 23:30 JST（アルゴ解析後）', enabled: true },
      { key: 'ab_test_decide',     label: 'A/Bテスト自動判定 (W1 vs W2)', schedule: 'W2終了後 月曜 09:00 JST', enabled: true },
    ],
  });
});

router.post('/bot/autonomy/run-directives', async (_req, res) => {
  try {
    console.log('  🤖 [API] 手動トリガー: 会議室決定事項の自動実行開始');
    const result = await runAutoDirectiveExecution();
    res.json({ ok: true, result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/bot/autonomy/run-ab-test', async (_req, res) => {
  try {
    console.log('  🧪 [API] 手動トリガー: A/Bテスト自動判定開始');
    const decision = await runABTestDecision();
    if (!decision) {
      res.json({ ok: false, message: 'W2期間中のため判定スキップ（4/20以降に実行可能）' });
    } else {
      res.json({ ok: true, decision });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
