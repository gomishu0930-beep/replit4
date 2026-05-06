import { Router } from 'express';
import { getAnalytics, getAllAnalytics, getAnalyticsStats, getRevenueSummary, getTemplateCategoryWeights, updateAnalyticsFromTweetMetrics, updateAnalyticsMetrics } from '../bot/post-analytics.js';
import { runWeeklyReview, getLatestWeeklyReview, getAllWeeklyReviews } from '../bot/weekly-review.js';
import { pickFanzaTemplate, CATEGORY_POOLS } from '../bot/fanza-templates.js';
import type { TemplateCategory } from '../bot/fanza-templates.js';
import { refreshRecentMetrics } from '../bot/analytics.js';
import { syncRebrandlyClicks } from '../bot/rebrandly.js';
import { getOwnRecentTweets } from '../bot/twitter.js';
import { recordPostManual, getRebrandlyData } from '../bot/storage.js';
import { getAgentWeights, refreshAgentWeights } from '../bot/agent-weight-service.js';
import { getRevenueWeightSignals, importRevenueReportRows, loadRevenueReports } from '../bot/revenue-report-store.js';

const router = Router();

// ─── 投稿アナリティクス ──────────────────────────────────────────────────────

// GET /api/analytics/posts?days=7
router.get('/posts', (req, res) => {
  const days = parseInt(String(req.query.days ?? '30'), 10);
  const records = getAnalytics(days);
  const stats = getAnalyticsStats(days);
  res.json({ ok: true, records, stats });
});

// GET /api/analytics/stats?days=7
router.get('/stats', (req, res) => {
  const days = parseInt(String(req.query.days ?? '7'), 10);
  res.json({ ok: true, stats: getAnalyticsStats(days) });
});

// GET /api/analytics/revenue?days=30
router.get('/revenue', (req, res) => {
  const days = parseInt(String(req.query.days ?? '30'), 10);
  res.json({ ok: true, ...getRevenueSummary(days) });
});

// POST /api/analytics/revenue-sync
// Rebrandlyクリック、X指標、直近TLをまとめて同期する。
router.post('/revenue-sync', async (_req, res) => {
  try {
    const [rebrandly, metrics] = await Promise.all([
      syncRebrandlyClicks().catch((e: any) => ({ error: e.message, synced: 0, totalClicks: getRebrandlyData().links.reduce((s, l) => s + l.clicks, 0) })),
      refreshRecentMetrics().catch((e: any) => ({ error: e.message, checked: 0, updated: 0 })),
    ]);

    let timeline = { total: 0, newCount: 0, updatedCount: 0 };
    try {
      const tweets = await getOwnRecentTweets(50);
      timeline.total = tweets.length;
      for (const t of tweets) {
        const metricsData = (t.public_metrics as any) ?? null;
        const { isNew } = recordPostManual({
          tweetId: t.id,
          text: t.text,
          postedAt: (t as any).created_at ?? new Date().toISOString(),
          metrics: metricsData,
        });
        if (metricsData) updateAnalyticsFromTweetMetrics(t.id, metricsData);
        if (isNew) timeline.newCount++; else timeline.updatedCount++;
      }
    } catch (e: any) {
      timeline = { ...timeline, total: 0, newCount: 0, updatedCount: 0 };
      console.warn('  ⚠ 収益同期TL取得失敗:', e.message);
    }

    res.json({ ok: true, rebrandly, metrics, timeline, revenue: getRevenueSummary(30) });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/analytics/revenue-report/import
// DMM/FANZA成果レポートのJSON行を取り込み、post_id/product_id/content_id単位のCVR/revenue信号にする。
router.post('/revenue-report/import', async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows)
      ? req.body.rows
      : Array.isArray(req.body)
        ? req.body
        : [];
    if (rows.length === 0) {
      res.status(400).json({ ok: false, error: 'rows array is required' });
      return;
    }
    const source = String(req.body?.source ?? 'manual');
    const result = await importRevenueReportRows(rows, source);
    res.json({ ok: true, ...result, signals: getRevenueWeightSignals() });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message ?? String(e) });
  }
});

// GET /api/analytics/revenue-report/signals
router.get('/revenue-report/signals', async (_req, res) => {
  await loadRevenueReports();
  res.json({ ok: true, signals: getRevenueWeightSignals() });
});

// GET /api/analytics/agent-weights
router.get('/agent-weights', async (_req, res) => {
  res.json({ ok: true, weights: await getAgentWeights() });
});

// POST /api/analytics/agent-weights/refresh
router.post('/agent-weights/refresh', async (req, res) => {
  try {
    const minSamples = req.body?.minSamples !== undefined ? Number(req.body.minSamples) : undefined;
    const weights = await refreshAgentWeights({ minSamples });
    res.json({ ok: true, weights });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message ?? String(e) });
  }
});

// GET /api/analytics/template-weights?days=30
router.get('/template-weights', (req, res) => {
  const days = parseInt(String(req.query.days ?? '30'), 10);
  res.json({ ok: true, weights: getTemplateCategoryWeights(days) });
});

// PATCH /api/analytics/posts/:postId/metrics
router.patch('/posts/:postId/metrics', (req, res) => {
  const { postId } = req.params;
  const { clicks, impressions, likes, reposts, replies } = req.body;
  updateAnalyticsMetrics(postId, { clicks, impressions, likes, reposts, replies });
  res.json({ ok: true });
});

// ─── 週次AIレビュー ──────────────────────────────────────────────────────────

// GET /api/analytics/weekly-review
router.get('/weekly-review', (req, res) => {
  const latest = getLatestWeeklyReview();
  const all = getAllWeeklyReviews();
  res.json({ ok: true, latest, history: all.slice(0, 10) });
});

// POST /api/analytics/weekly-review/run
router.post('/weekly-review/run', async (req, res) => {
  const force = req.body?.force === true;
  try {
    const result = await runWeeklyReview(force);
    res.json({ ok: true, result });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── テンプレートプレビュー ──────────────────────────────────────────────────

// GET /api/analytics/templates
// カテゴリ別テンプレート一覧（プレースホルダーのまま返す）
router.get('/templates', (req, res) => {
  const categories = Object.keys(CATEGORY_POOLS) as TemplateCategory[];
  const result = categories.map(cat => ({
    category: cat,
    count: CATEGORY_POOLS[cat].length,
    samples: CATEGORY_POOLS[cat].slice(0, 2).map(t => ({ id: t.id, text: t.text })),
  }));
  res.json({ ok: true, templates: result });
});

// POST /api/analytics/templates/preview
// ダミーitemでテンプレートをプレビューする
router.post('/templates/preview', (req, res) => {
  const { category, count = 3 } = req.body;
  const dummyItem = {
    title: '仮タイトル・サンプル作品',
    content_id: 'sample001',
    review: { average: '4.3', count: 120 },
    iteminfo: {
      actress: [{ name: 'サンプル女優' }],
      genre: [{ name: '素人' }],
    },
    affiliateURL: 'https://example.com/affiliate/sample',
  };

  const results = [];
  for (let i = 0; i < count; i++) {
    const tmpl = category
      ? pickFanzaTemplate(dummyItem, 'random', category as TemplateCategory)
      : pickFanzaTemplate(dummyItem, 'random');
    results.push(tmpl);
  }
  res.json({ ok: true, previews: results });
});

export default router;
