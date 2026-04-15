import cron from 'node-cron';

import { getRandomItems, getSampleImages, discoverCampaignIds } from './fanza.js';
import { uploadImages, postTweet, replyToTweet, getAccountInfo, getOwnRecentTweets } from './twitter.js';
import { generateTweetText, generateEngagementReply, generateImpressionTweet, buildManualPostFeedback } from './ai.js';
import { recordPost, recordPostManual, getTopPatterns, getExternalTopPatterns, getPostsAfter, getStats, recordAccountSnapshot, getLatestSnapshot, getRebrandlyData, getDailyImpressionSnapshots, recordManualFeedback } from './storage.js';
import { syncRebrandlyClicks, resolveShortUrl } from './rebrandly.js';
import { runAutonomousMeeting, runMeetingAndPost } from './auto-meeting.js';
import { refreshExternalPatterns, checkShadowbanRecovery, refreshRecentMetrics } from './analytics.js';
import { loadStrategyConfig, evaluateAndAdapt, runDailyEvaluation, getMonitorIntervalMs, getStrategySummary } from './strategy.js';
import { startWatchdog, injectSchedulerHooks } from './watchdog.js';
import { autoCompleteTask } from './tasks.js';
import { validatePost, recordPostEvent, loadSafetyState, updateFollowerCount, getSafetyStatus } from './safety-engine.js';
import {
  appendPostLog,
  appendAccountMetrics,
  upsertHypotheses,
  initSheetHeaders,
  isSheetsConfigured,
} from './sheets-writer.js';

let isPosting = false;
let _postingStartedAt: number | null = null;

export function getIsPosting() { return isPosting; }
export function getPostingStartedAt() { return _postingStartedAt; }
export function forceResetIsPosting() {
  console.log('  [WATCHDOG] isPosting強制リセット');
  isPosting = false;
  _postingStartedAt = null;
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function randomSleep(minSec: number, maxSec: number) {
  const ms = (minSec + Math.random() * (maxSec - minSec)) * 1000;
  console.log(`  ⏳ ${Math.round(ms / 1000)}秒 待機中...`);
  return sleep(ms);
}

type ContentSlotType = 'engagement' | 'fanza' | 'myfans';

function pickSlotType(): ContentSlotType {
  const rand = Math.random() * 100;
  if (rand < 70) return 'engagement';
  if (rand < 90) return 'fanza';
  return 'myfans';
}

async function postFanzaItem(item: any, type: string, label: string) {
  const validation = validatePost(true);
  if (!validation.allowed) {
    console.log(`  [${label}] 安全制限: ${validation.errors.join(', ')}`);
    return null;
  }

  const topPatterns = getTopPatterns(10);
  const externalPatterns = getExternalTopPatterns(10);
  const genResult = await generateTweetText(item, type, topPatterns, externalPatterns);
  const text = genResult.text;
  const imagePrompt = genResult.imagePrompt;
  if (imagePrompt) console.log(`  🖼️ 画像プロンプト: ${imagePrompt.slice(0, 80)}...`);
  const imageUrls = getSampleImages(item);
  const mediaIds = await uploadImages(imageUrls);
  const tweetId = await postTweet(text, mediaIds);

  await randomSleep(30, 90);

  const reviewAvg = parseFloat(item.review?.average ?? '0');
  const reviewCount = item.review?.count ?? 0;
  const isHighScore = reviewAvg >= 4.3 && reviewCount >= 25;
  const affiliateURL = await resolveShortUrl(
    item.affiliateURL ?? '',
    isHighScore ? (item.content_id ?? item.id) : undefined,
    isHighScore ? item.title : undefined,
  );
  const replyId = await replyToTweet(tweetId, `🔗 作品ページはこちら👇\n${affiliateURL}`);

  await randomSleep(20, 60);
  const engagementText = generateEngagementReply(type);
  await replyToTweet(replyId, engagementText);

  recordPost({ tweetId, replyId, item, text, type, imagePrompt });
  recordPostEvent(true);

  if (isSheetsConfigured()) {
    appendPostLog({
      postedAt: new Date().toISOString(),
      celebrity: '',
      itemTitle: item.title,
      tweetText: text,
      tweetId,
      postType: type,
    }).catch(() => {});
  }

  console.log(`  ✅ [${label}] FANZA投稿完了 (${tweetId})`);
  return tweetId;
}

async function postEngagementSlot(label: string) {
  const validation = validatePost(false);
  if (!validation.allowed) {
    console.log(`  [${label}] 安全制限: ${validation.errors.join(', ')}`);
    return;
  }

  const { text } = generateImpressionTweet(Math.random() < 0.3);
  const tweetId = await postTweet(text, []);
  recordPost({ tweetId, replyId: '', text, type: 'engagement' });
  recordPostEvent(false);
  console.log(`  ✅ [${label}] エンゲージメント投稿完了 (${tweetId})`);
}

async function postMyFansSlot(label: string) {
  const validation = validatePost(true);
  if (!validation.allowed) {
    console.log(`  [${label}] 安全制限: ${validation.errors.join(', ')}`);
    return;
  }

  const templates = [
    '💕 MyFansで限定コンテンツ配信中！\n無料で覗けるから気軽にチェックしてね✨\n#MyFans #限定コンテンツ',
    '🔥 MyFansならではの特別コンテンツ！\nフォローだけでも見れるものがたくさん📱\n#MyFans',
    '✨ 今日も新しいコンテンツをMyFansに投稿しました！\nプロフのリンクからどうぞ💖\n#MyFans #新着',
  ];
  const text = templates[Math.floor(Math.random() * templates.length)];
  const tweetId = await postTweet(text, []);
  recordPost({ tweetId, replyId: '', text, type: 'myfans' });
  recordPostEvent(true);
  console.log(`  ✅ [${label}] MyFans投稿完了 (${tweetId})`);
}

export async function triggerEmergencyPost(): Promise<void> {
  const items = await getRandomItems(1);
  if (items.length === 0) throw new Error('緊急投稿: アイテム取得失敗');
  const result = await postFanzaItem(items[0], 'emergency', '緊急回復投稿');
  if (result === null) throw new Error('緊急投稿: 安全制限により投稿不可');
}

async function runScheduledSlot(label: string) {
  if (isPosting) {
    console.log(`  [${label}] 前の投稿処理が進行中 → スキップ`);
    return;
  }

  const safety = getSafetyStatus();
  if (safety.automationLevel === 'MANUAL_ONLY') {
    console.log(`  [${label}] 手動モード中 → 自動投稿スキップ`);
    return;
  }

  isPosting = true;
  _postingStartedAt = Date.now();
  try {
    const slotType = pickSlotType();
    const jst = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    console.log(`\n[${jst}] ${label} スロット開始 (type: ${slotType})`);

    switch (slotType) {
      case 'engagement':
        await postEngagementSlot(label);
        break;
      case 'fanza': {
        const items = await getRandomItems(1);
        if (items.length > 0) await postFanzaItem(items[0], 'random', label);
        break;
      }
      case 'myfans':
        await postMyFansSlot(label);
        break;
    }
  } catch (e: any) {
    console.error(`  ❌ [${label}] エラー: ${e.message}`);
  } finally {
    isPosting = false;
    _postingStartedAt = null;
  }
}

async function monitoringLoop() {
  const jst = () => new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  while (true) {
    const intervalMs = getMonitorIntervalMs();
    try {
      if (!isPosting) {
        console.log(`\n[${jst()}] 📡 外部パターン監視サイクル開始`);
        const newPatterns = await refreshExternalPatterns();
        await evaluateAndAdapt(newPatterns ?? 0);
      }
    } catch (e: any) {
      console.error(`  ❌ 監視サイクルエラー: ${e.message}`);
    }
    await sleep(intervalMs);
  }
}

export function startScheduler() {
  loadSafetyState();

  loadStrategyConfig().catch((e: any) =>
    console.warn('  ⚠ 戦略設定読み込み失敗:', e.message),
  );

  if (isSheetsConfigured()) {
    console.log('  📊 [Sheets] Google Sheets 連携: 有効');
    sleep(30 * 1000).then(() =>
      initSheetHeaders().catch((e: any) => console.warn('  ⚠ [Sheets] ヘッダー初期化失敗:', e.message)),
    );
  }

  injectSchedulerHooks({ getIsPosting, getPostingStartedAt, forceResetIsPosting, triggerEmergencyPost });
  sleep(3 * 60 * 1000).then(() => startWatchdog());

  async function startMonitoringLoop() {
    await sleep(5 * 60 * 1000);
    while (true) {
      try { await monitoringLoop(); } catch (e: any) {
        console.error(`  ❌ 監視ループ異常終了: ${e.message} — 5分後再起動`);
        await sleep(5 * 60 * 1000);
      }
    }
  }
  startMonitoringLoop();

  sleep(10 * 60 * 1000).then(() =>
    discoverCampaignIds({ maxProbe: 200 }).catch((e: any) =>
      console.warn('  ⚠ キャンペーンID探索失敗:', e.message),
    ),
  );

  cron.schedule('0 3 * * 0', async () => {
    await discoverCampaignIds({ maxProbe: 300 }).catch((e: any) =>
      console.warn('  ⚠ キャンペーンID週次探索失敗:', e.message),
    );
    autoCompleteTask('weekly-campaign-scan', 'weekly').catch(() => {});
  }, { timezone: 'Asia/Tokyo' });

  // 10:30 JST — エンゲージメント投稿①
  cron.schedule('30 10 * * *', () => runScheduledSlot('10:30 スロット①'), { timezone: 'Asia/Tokyo' });

  // 17:00 JST — FANZA/MyFans/エンゲージメント投稿②
  cron.schedule('0 17 * * *', () => runScheduledSlot('17:00 スロット②'), { timezone: 'Asia/Tokyo' });

  // 20:00 JST — プライムタイム投稿③
  cron.schedule('0 20 * * *', () => runScheduledSlot('20:00 スロット③'), { timezone: 'Asia/Tokyo' });

  // 火・木 20:00 JST — AI会議→投稿サイクル
  cron.schedule('0 20 * * 2,4', async () => {
    const safety = getSafetyStatus();
    if (safety.automationLevel === 'MANUAL_ONLY') return;
    console.log('\n  🎙 [火/木会議] AI会議→投稿サイクル開始...');
    try {
      const result = await runMeetingAndPost();
      if (result.posted) console.log(`  ✅ [会議→投稿] 投稿完了: ${result.tweetId}`);
    } catch (e: any) {
      console.error(`  ❌ [会議→投稿] エラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 月曜 04:00 JST — 週次自律AI会議
  cron.schedule('0 4 * * 1', async () => {
    const safety = getSafetyStatus();
    if (safety.automationLevel === 'MANUAL_ONLY') return;
    console.log('\n  🤝 [自律会議] 週次AI会議自動実行中...');
    try {
      const result = await runAutonomousMeeting();
      console.log(`  ✅ [自律会議] 完了: 自動実行${result.autoExecuted.length}件`);
    } catch (e: any) {
      console.error(`  ❌ [自律会議] エラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 09:00 JST — 日次フォロワースナップショット + Safety Engine更新
  cron.schedule('0 9 * * *', async () => {
    try {
      const prev = getLatestSnapshot();
      const info = await getAccountInfo();
      if (!info) return;
      recordAccountSnapshot({ followersCount: info.followersCount, followingCount: info.followingCount, tweetCount: info.tweetCount, note: '日次自動記録' });
      updateFollowerCount(info.followersCount);

      if (prev) {
        const delta = info.followersCount - prev.followersCount;
        console.log(`  📊 [日次スナップ] フォロワー: ${info.followersCount}人 (${delta >= 0 ? '+' : ''}${delta}人)`);
      }

      if (isSheetsConfigured()) {
        const snaps = getDailyImpressionSnapshots(7);
        const avgImp = snaps.length > 0 ? Math.round(snaps.reduce((a, b) => a + b.avgImpressions, 0) / snaps.length) : 0;
        const nowJst = new Date(Date.now() + 9 * 3600000);
        const todayStart = new Date(Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate()) - 9 * 3600000);
        const todayPosts = getPostsAfter(todayStart).length;
        await appendAccountMetrics({
          recordedAt: new Date().toISOString(),
          followersCount: info.followersCount,
          followingCount: info.followingCount,
          tweetCount: info.tweetCount,
          avgImpressions: avgImp,
          totalPostsToday: todayPosts,
          note: '日次自動記録',
        }).catch((e: any) => console.warn('  ⚠ [Sheets] AccountMetrics書き込み失敗:', e.message));
      }
    } catch (e: any) {
      console.warn('  ⚠ 日次スナップ失敗:', e.message);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 06:00 JST — Rebrandlyクリック数自動同期
  cron.schedule('0 6 * * *', async () => {
    try {
      const result = await syncRebrandlyClicks();
      if (result) console.log(`  🔗 [Rebrandly] 同期完了: ${result.synced}件 / 総クリック ${result.totalClicks}`);
    } catch (e: any) {
      console.warn('  ⚠ Rebrandly同期失敗:', e.message);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 08:00 JST — タイムライン自動同期
  cron.schedule('0 8 * * *', async () => {
    try {
      const tweets = await getOwnRecentTweets(50);
      let newCount = 0, updatedCount = 0;
      for (const t of tweets) {
        const { isNew } = recordPostManual({
          tweetId: t.id, text: t.text,
          postedAt: (t as any).created_at ?? new Date().toISOString(),
          metrics: (t.public_metrics as any) ?? null,
        });
        if (isNew) newCount++; else updatedCount++;
      }
      console.log(`  ✅ [TL同期] 新規: ${newCount}件 / 更新: ${updatedCount}件`);
    } catch (e: any) {
      console.warn(`  ⚠ [TL同期] 失敗: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 23:00 JST — シャドウバン回復チェック
  cron.schedule('0 23 * * *', async () => {
    try {
      await checkShadowbanRecovery();
      autoCompleteTask('daily-shadowban-check', 'daily').catch(() => {});
    } catch (e: any) {
      console.error(`  ❌ 回復チェックエラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 23:10 JST — 投稿指標更新
  cron.schedule('10 23 * * *', async () => {
    try {
      await refreshRecentMetrics();
      console.log('  ✅ [指標更新] 完了');
    } catch (e: any) {
      console.error(`  ❌ [指標更新] エラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 03:00 JST — 日次戦略評価
  cron.schedule('0 3 * * *', async () => {
    try {
      await runDailyEvaluation();
      if (isSheetsConfigured()) {
        const strategy = getStrategySummary();
        if ((strategy.hypotheses ?? []).length > 0) {
          await upsertHypotheses(
            strategy.hypotheses.map((h: any) => ({
              id: h.id, question: h.question, status: h.status,
              finding: h.finding ?? '', adjustment: h.adjustment ?? '',
              testedAt: h.testedAt ?? new Date().toISOString(),
            })),
          ).catch((e: any) => console.warn('  ⚠ [Sheets] Hypotheses書き込み失敗:', e.message));
        }
      }
    } catch (e: any) {
      console.error(`  ❌ 日次評価エラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 月曜 08:00 JST — 週次レポート
  cron.schedule('0 8 * * 1', async () => {
    try {
      const info = await getAccountInfo();
      if (info) {
        recordAccountSnapshot({ followersCount: info.followersCount, followingCount: info.followingCount, tweetCount: info.tweetCount, note: '週次自動記録' });
        updateFollowerCount(info.followersCount);
      }
    } catch (e: any) {
      console.warn('  ⚠ 週次スナップ失敗:', e.message);
    }

    try {
      const fb = await buildManualPostFeedback(7);
      if (fb) {
        recordManualFeedback(fb);
        console.log(`  ✅ 手動投稿FB完了: ${fb.tweetCount}件分析`);
      }
    } catch (e: any) {
      console.warn('  ⚠ 手動投稿FB失敗:', e.message);
    }

    autoCompleteTask('weekly-perf-report', 'weekly').catch(() => {});
  }, { timezone: 'Asia/Tokyo' });

  const safety = getSafetyStatus();
  console.log('');
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║  MyFans×FANZA 二刀流Bot                      ║');
  console.log('╠═══════════════════════════════════════════════╣');
  console.log(`║  🛡️ 安全レベル: ${safety.automationLevel.padEnd(30)}║`);
  console.log(`║  📊 リスクスコア: ${String(safety.riskScore).padEnd(28)}║`);
  console.log(`║  👥 フォロワー: ${String(safety.followerCount).padEnd(29)}║`);
  console.log('║  📅 投稿スロット:                              ║');
  console.log('║    10:30 / 17:00 / 20:00 JST                  ║');
  console.log('║  📈 比率: 70%エンゲージ / 20%FANZA / 10%MyFans ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log('');
}
