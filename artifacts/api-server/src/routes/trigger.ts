import { Router } from 'express';
import { getHighRatedItems, getSaleItems, getBuzzItems, getRandomItems, getAmateurItems, getKeywordItems, getItemById, getSampleImages } from '../bot/fanza.js';
import { uploadImages, postTweet, replyToTweet, pauseBot, resumeBot, isBotPaused, getPausedReason } from '../bot/twitter.js';
import { generateTweetText, generateEngagementReply } from '../bot/ai.js';
import { recordPost, getTopPatterns, getExternalTopPatterns, getPostsAfter, getRebrandlyData } from '../bot/storage.js';
import { sendMeetingFullLog, sendMetricsReport, MetricsReportPost } from '../bot/contact.js';
import { getMeetingById, getMeetings } from '../bot/meeting.js';
import { getIsPosting as getSchedulerIsPosting, postCelebritySlotNow } from '../bot/scheduler.js';
import { runMeetingAndPost, runAutonomousMeeting, runEmergencyMeeting } from '../bot/auto-meeting.js';

import { refreshRecentMetrics, refreshExternalPatterns } from '../bot/analytics.js';

const router = Router();

const TRIGGER_SECRET = process.env.TRIGGER_SECRET ?? 'fanza-bot-trigger';

let isPosting = false;
let _postingLock: Promise<void> = Promise.resolve();

function getABTestWeek(): 'W1' | 'W2' | 'normal' {
  const nowJst = new Date(Date.now() + 9 * 3600000);
  const dateKey = nowJst.toISOString().slice(0, 10);
  if (dateKey >= '2026-04-07' && dateKey <= '2026-04-13') return 'W1';
  if (dateKey >= '2026-04-14' && dateKey <= '2026-04-20') return 'W2';
  return 'normal';
}

async function postItem(item: any, type: string) {
  const topPatterns = getTopPatterns(5);
  const externalPatterns = getExternalTopPatterns(5);
  const text = await generateTweetText(item, type, topPatterns, externalPatterns);
  const imageUrls = getSampleImages(item);
  const mediaIds = await uploadImages(imageUrls);
  const tweetId = await postTweet(text, mediaIds);
  const replyId = await replyToTweet(tweetId, `🔗 作品ページはこちら👇\n${item.affiliateURL ?? ''}`);
  // 3投目：エンゲージメント誘導リプライ
  const engagementText = generateEngagementReply(type);
  await replyToTweet(replyId, engagementText);
  recordPost({ tweetId, replyId, item, text, type });
  return tweetId;
}

// 当日のJST0:00以降の投稿件数を返す
function getTodayPostCount(): number {
  const nowJst = new Date(Date.now() + 9 * 3600000);
  const todayMidnightJst = new Date(
    Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate()) - 9 * 3600000,
  );
  return getPostsAfter(todayMidnightJst).length;
}

async function runJob(type: string, label: string, fetchItems: () => Promise<any[]>) {
  // スケジューラーとの排他制御（scheduler.ts の isPosting も確認）
  if (isPosting || getSchedulerIsPosting()) {
    return { skipped: true, reason: '別の投稿が進行中（スケジューラー含む）' };
  }

  // A/Bテスト週は手動トリガーも1件限定（1日1件制限を維持）
  const abWeek = getABTestWeek();
  const maxItems = (abWeek === 'W1' || abWeek === 'W2') ? 1 : 3;
  if (abWeek !== 'normal') {
    const todayCount = getTodayPostCount();
    if (todayCount >= 1) {
      console.warn(`  ⚠ [trigger/${type}] ${abWeek}期間中に本日分(${todayCount}件)投稿済み → 手動トリガー実行（注意: 1日1件制限を超えます）`);
      return {
        ok: false,
        skipped: true,
        reason: `⚠ ${abWeek}期間中は1日1件制限です。本日すでに${todayCount}件投稿済みです。シャドウバン回復に影響する可能性があります。`,
        todayCount,
      };
    }
    console.log(`  ⚠ [trigger/${type}] ${abWeek}期間中 → 手動トリガー投稿を1件限定で実行`);
  }

  // 競合防止ロック（isPosting フラグを同期的に設定）
  isPosting = true;
  const results = [];
  try {
    const allItems = await fetchItems();
    const items = allItems.slice(0, maxItems);
    for (const item of items) {
      const tweetId = await postItem(item, type);
      results.push({ tweetId, title: item.title });
    }
    console.log(`[${label}] ✅ ${results.length}件投稿完了`);
    return { ok: true, label, posted: results.length, results };
  } catch (e: any) {
    console.error(`[${label}] ❌ エラー: ${e.message}`);
    return { ok: false, label, error: e.message };
  } finally {
    isPosting = false;
  }
}

function auth(req: any, res: any, next: any) {
  const secret = req.headers['x-trigger-secret'] ?? req.query.secret;
  if (secret !== TRIGGER_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// 12:00 JST 高評価
router.post('/trigger/rank', auth, async (_req, res) => {
  const result = await runJob('buzz', '12:00 高評価', () => getHighRatedItems(2));
  res.json(result);
});

// 15:00 / 23:00 JST セール
router.post('/trigger/sale', auth, async (_req, res) => {
  const result = await runJob('sale', 'セール', () => getSaleItems(3));
  res.json(result);
});

// 18:00 JST バズ + 指標更新
router.post('/trigger/buzz', auth, async (_req, res) => {
  await refreshRecentMetrics();
  const result = await runJob('buzz', '18:00 バズ', () => getBuzzItems(3));
  res.json(result);
});

// 21:00 JST ランダム
router.post('/trigger/random', auth, async (_req, res) => {
  const result = await runJob('random', '21:00 ランダム', () => getRandomItems(3));
  res.json(result);
});

// 08:30 JST 素人
router.post('/trigger/amateur', auth, async (_req, res) => {
  const result = await runJob('amateur', '08:30 素人', () => getAmateurItems(3));
  res.json(result);
});

// 商品ID指定投稿（cid で作品ピンポイント指定）
router.post('/trigger/cid', auth, async (req, res) => {
  const cid = (req.query.cid as string) || (req.body?.cid as string);
  if (!cid) {
    res.status(400).json({ ok: false, error: 'クエリ ?cid=商品ID を指定してください' });
    return;
  }
  if (isPosting || getSchedulerIsPosting()) {
    res.status(429).json({ ok: false, error: '別の投稿が進行中（スケジューラー含む）' });
    return;
  }
  // A/Bテスト週: 1日1件制限チェック
  const abWeek = getABTestWeek();
  if (abWeek !== 'normal') {
    const todayCount = getTodayPostCount();
    if (todayCount >= 1) {
      res.status(429).json({
        ok: false,
        reason: `⚠ ${abWeek}期間中は1日1件制限です。本日すでに${todayCount}件投稿済みです。`,
        todayCount,
      });
      return;
    }
  }
  isPosting = true;
  try {
    const item = await getItemById(cid);
    if (!item) {
      res.status(404).json({ ok: false, error: `商品ID [${cid}] が見つかりませんでした` });
      return;
    }
    const tweetId = await postItem(item, 'amateur');
    res.json({ ok: true, tweetId, title: item.title });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    isPosting = false;
  }
});

// キーワード指定投稿（特定作品を1件投稿）
router.post('/trigger/keyword', auth, async (req, res) => {
  const keyword = (req.query.q as string) || (req.body?.keyword as string);
  if (!keyword) {
    res.status(400).json({ ok: false, error: 'クエリ ?q=キーワード を指定してください' });
    return;
  }
  const result = await runJob('amateur', `キーワード指定[${keyword}]`, () => getKeywordItems(keyword, 1));
  res.json(result);
});

// 芸能人アフィリ緊急手動投稿（W1制限を無視して即時投稿）
router.post('/trigger/celebrity', auth, async (_req, res) => {
  if (isPosting || getSchedulerIsPosting()) {
    res.status(429).json({ ok: false, error: '別の投稿が進行中（スケジューラー含む）' });
    return;
  }
  const abWeek = getABTestWeek();
  const todayCount = getTodayPostCount();
  console.log(`\n[緊急手動] 芸能人アフィリ投稿開始 (${abWeek} / 本日${todayCount}件目)`);
  try {
    await postCelebritySlotNow('手動緊急');
    res.json({
      ok: true,
      warn: abWeek !== 'normal' ? `⚠ ${abWeek}期間中の追加投稿です。シャドウバン回復に注意してください。` : undefined,
    });
  } catch (e: any) {
    console.error('[緊急手動] 芸能人投稿エラー:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── 会議→投稿：AI3者会議→Grok裁定→ツイート生成→X投稿（頭→手サイクル）─────────

// 会議→裁定投稿トリガー（バックグラウンド実行・即202を返す）
router.post('/trigger/meeting-post', auth, (req, res) => {
  const bypass = req.query.bypass === 'true' || req.body?.bypassDailyLimit === true;
  res.status(202).json({
    ok: true,
    message: `✅ AI3者会議（頭→手サイクル）を開始しました。会議完了後にGrokの裁定に基づき自動投稿されます（約15〜20分）。${bypass ? '※日次制限バイパスモード' : ''}`,
  });
  runMeetingAndPost({ bypassDailyLimit: bypass }).catch((e: any) =>
    console.error(`[会議投稿] 予期せぬエラー: ${e.message}`),
  );
});

// 指標更新のみ（投稿なし）
router.post('/trigger/metrics', auth, async (_req, res) => {
  try {
    console.log('\n[指標更新] 手動トリガー');
    await refreshRecentMetrics();
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 外部パターン収集 (06:00 JST / 手動)
router.post('/trigger/external-patterns', auth, async (_req, res) => {
  if (isPosting) {
    res.status(429).json({ ok: false, error: '投稿処理中のためスキップ' });
    return;
  }
  try {
    console.log('\n[外部パターン収集] 手動トリガー');
    const added = await refreshExternalPatterns();
    res.json({ ok: true, added });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── 会議ログのメール送信（オンデマンド）──────────────────────────────────────

// POST /api/trigger/send-meeting-log  body: { id?: string }（省略時は最新会議）
router.post('/trigger/send-meeting-log', auth, async (req, res) => {
  try {
    const sessions = getMeetings();
    const targetId = (req.body?.id as string | undefined);
    const session = targetId ? getMeetingById(targetId) : sessions[sessions.length - 1];

    if (!session) {
      res.status(404).json({ ok: false, error: '会議が見つかりません' });
      return;
    }

    await sendMeetingFullLog({
      title: session.title,
      sessionId: session.id,
      messages: session.messages,
      summary: `手動送信リクエスト by /trigger/send-meeting-log`,
      decisions: (session.decisionCandidates ?? []).map(
        (c: any) => `[${c.assignee ?? '?'}/${c.priority ?? '?'}] ${c.text ?? ''}`,
      ),
      duration_ms: 0,
    });

    res.json({ ok: true, sessionId: session.id, title: session.title, messageCount: session.messages.length });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── 緊急会議（凍結インシデント対応・新規スタート）──────────────────────────────

let isEmergencyMeetingRunning = false;

router.post('/trigger/emergency-meeting', auth, async (_req, res) => {
  if (isEmergencyMeetingRunning) {
    res.status(429).json({ ok: false, error: '緊急会議は既に実行中です' });
    return;
  }
  isEmergencyMeetingRunning = true;
  res.json({ ok: true, message: '緊急会議を開始しました（10〜15分かかります）。完了したら通知されます。' });

  runEmergencyMeeting()
    .then(result => {
      console.log(`  ✅ [緊急会議エンドポイント] 完了: ${result.totalDecisions}件決定`);
    })
    .catch(e => {
      console.error('  ❌ [緊急会議エンドポイント] エラー:', e.message);
    })
    .finally(() => {
      isEmergencyMeetingRunning = false;
    });
});

// POST /api/trigger/send-metrics-report — 週次メトリクスレポートを今すぐ手動送信
router.post('/trigger/send-metrics-report', auth, async (req, res) => {
  try {
    const days = Number(req.body?.days ?? 7);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const posts = getPostsAfter(since);
    const rbData = getRebrandlyData();
    const rbTotalClicks = rbData.links.reduce((s: number, l: any) => s + l.clicks, 0);

    const metricsRows: MetricsReportPost[] = posts.map((p: any) => {
      const imp = p.metrics?.impression_count ?? 0;
      const likes = p.metrics?.like_count ?? 0;
      const rt = p.metrics?.retweet_count ?? 0;
      const rbLink = rbData.links.find((l: any) => l.destination === p.item?.affiliateURL);
      const clicks = rbLink?.clicks ?? 0;
      const er = imp > 0 ? (likes + rt) / imp : 0;
      const pvr = imp > 0 ? clicks / imp : 0;
      return {
        postedAt: p.postedAt,
        type: p.type,
        text: p.text,
        impressions: imp,
        likes,
        retweets: rt,
        clicks,
        sbStatus: imp > 0 ? (imp >= 10 ? '正常' : 'SB疑い') : '未計測',
        note: p.contentType ?? '',
        engagementRate: er,
        pvr,
      };
    });

    const totalImp = metricsRows.reduce((s, p) => s + p.impressions, 0);
    const avgImp = metricsRows.length > 0 ? totalImp / metricsRows.length : 0;
    const startDate = since.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
    const endDate = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
    const sbNormal = metricsRows.filter(p => p.sbStatus === '正常').length;

    await sendMetricsReport({
      period: `${startDate}〜${endDate}`,
      posts: metricsRows,
      avgImpression: avgImp,
      totalLikes: metricsRows.reduce((s, p) => s + p.likes, 0),
      totalRetweets: metricsRows.reduce((s, p) => s + p.retweets, 0),
      totalClicks: rbTotalClicks,
      rbLinks: rbData.links.length,
      sbStatusSummary: `正常${sbNormal}件 / SB疑い${metricsRows.length - sbNormal}件`,
    });

    res.json({ ok: true, postCount: metricsRows.length, avgImpression: avgImp.toFixed(1), period: `${startDate}〜${endDate}` });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── 緊急停止 / 再開 ──────────────────────────────────────────────────────────

// POST /api/trigger/pause — 全投稿を即時停止（認証必須）
router.post('/trigger/pause', auth, async (req, res) => {
  const reason = (req.body?.reason as string) || '手動緊急停止';
  await pauseBot(reason);
  res.json({ ok: true, paused: true, reason });
});

// POST /api/trigger/resume — 投稿を再開（認証必須）
router.post('/trigger/resume', auth, async (_req, res) => {
  await resumeBot();
  res.json({ ok: true, paused: false });
});

// GET /api/bot/pause-status — 停止状態を確認（認証不要）
router.get('/bot/pause-status', (_req, res) => {
  res.json({ paused: isBotPaused(), reason: getPausedReason() });
});

export default router;
