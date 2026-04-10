import cron from 'node-cron';

import { getRandomItems, getSampleImages, discoverCampaignIds } from './fanza.js';
import { uploadImages, postTweet, replyToTweet, getAccountInfo, getOwnRecentTweets } from './twitter.js';
import { generateTweetText, generateEngagementReply, generateCelebrityMainTweet, generateCelebrityIntroReply, generateImpressionTweet, getLastContentType, buildManualPostFeedback } from './ai.js';
import { recordPost, recordPostManual, getTopPatterns, getExternalTopPatterns, getPostsAfter, getStats, getDynamicTemplatesInfo, getExternalPatternsInfo, recordAccountSnapshot, getCelebPostedDate, setCelebPostedDate, recordManualFeedback, getLatestSnapshot, getRebrandlyData, getDailyImpressionSnapshots } from './storage.js';
import { syncRebrandlyClicks, resolveShortUrl } from './rebrandly.js';
import { runAlgoAnalysis } from './algo.js';
import { collectAlgoNews } from './algo-news.js';
import { runAutoDirectiveExecution, applyAlgoRecommendations, runABTestDecision } from './auto-execute.js';
import { runAutonomousMeeting, runMeetingAndPost } from './auto-meeting.js';
import { refreshExternalPatterns, checkShadowbanRecovery, refreshRecentMetrics } from './analytics.js';
import { pickCelebrity, pickRandom, getBestPostingHour, getCelebrityLikeItems, CelebrityMapping } from './celebrity.js';
import { contact, sendMetricsReport, MetricsReportPost } from './contact.js';
import { loadStrategyConfig, evaluateAndAdapt, runDailyEvaluation, getMonitorIntervalMs, getStrategySummary } from './strategy.js';
import { startWatchdog, injectSchedulerHooks } from './watchdog.js';
import { autoCompleteTask } from './tasks.js';
import { loadSchedulerOverrides } from './codex-agent.js';
import {
  appendPostLog,
  appendAccountMetrics,
  upsertHypotheses,
  appendAlgoInsight,
  initSheetHeaders,
  isSheetsConfigured,
} from './sheets-writer.js';

let isPosting = false;
let _postingStartedAt: number | null = null;

// ウォッチドッグ向けフック公開
export function getIsPosting() { return isPosting; }
export function getPostingStartedAt() { return _postingStartedAt; }
export function forceResetIsPosting() {
  console.log('  🔧 [WATCHDOG] isPostingフラグを強制リセット');
  isPosting = false;
  _postingStartedAt = null;
}

// ランダム待機（凍結対策）
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function randomSleep(minSec: number, maxSec: number) {
  const ms = (minSec + Math.random() * (maxSec - minSec)) * 1000;
  console.log(`  ⏳ ${Math.round(ms / 1000)}秒 待機中...`);
  return sleep(ms);
}

async function postItem(item: any, type: string, label: string) {
  console.log(`  📝 [${label}] 投稿処理開始: ${item.title?.slice(0, 30)}`);

  const topPatterns = getTopPatterns(10);
  const externalPatterns = getExternalTopPatterns(10);
  const text = await generateTweetText(item, type, topPatterns, externalPatterns);
  const contentType = getLastContentType(); // Claude が選んだ5型を取得
  const imageUrls = getSampleImages(item);
  const mediaIds = await uploadImages(imageUrls);
  const tweetId = await postTweet(text, mediaIds);

  // ツイート→リプライ間：30〜90秒待機（人間的な間隔）
  await randomSleep(30, 90);

  // スコア閾値：レビュー平均4.3点以上 かつ 25件以上の場合のみRebrandly自動登録
  const reviewAvg = parseFloat(item.review?.average ?? '0');
  const reviewCount = item.review?.count ?? 0;
  const isHighScore = reviewAvg >= 4.3 && reviewCount >= 25;
  const affiliateURL = await resolveShortUrl(
    item.affiliateURL ?? '',
    isHighScore ? (item.content_id ?? item.id) : undefined,
    isHighScore ? item.title : undefined,
  );
  if (!isHighScore) console.log(`  ℹ️  [Rebrandly] 低スコア (★${reviewAvg}/${reviewCount}件) → 元のURLを使用`);
  const replyId = await replyToTweet(tweetId, `🔗 作品ページはこちら👇\n${affiliateURL}`);

  // リプライ1→2間：20〜60秒待機
  await randomSleep(20, 60);

  // 3投目：エンゲージメント誘導リプライ
  const engagementText = generateEngagementReply(type);
  await replyToTweet(replyId, engagementText);

  recordPost({ tweetId, replyId, item, text, type, contentType });
  console.log(`  ✅ [${label}] 投稿完了 [${contentType}] (${tweetId})`);
}

async function postItems(items: any[], type: string, label: string) {
  if (isPosting) {
    console.log(`  ⚠ [${label}] 前の投稿処理が進行中 — スキップ`);
    return;
  }
  isPosting = true;
  _postingStartedAt = Date.now();
  try {
    console.log(`\n[${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}] ${label} 投稿開始 (${items.length}件)`);
    for (let i = 0; i < items.length; i++) {
      await postItem(items[i], type, label);
      if (i < items.length - 1) {
        await randomSleep(5 * 60, 15 * 60);
      }
    }
  } catch (e: any) {
    console.error(`  ❌ [${label}] エラー: ${e.message}`);
    await contact.postingFailed(label, e.message);
  } finally {
    isPosting = false;
    _postingStartedAt = null;
  }
}

// ウォッチドッグ用：緊急投稿（ランダム1件を即時投稿）
export async function triggerEmergencyPost(): Promise<void> {
  const items = await getRandomItems(1);
  if (items.length === 0) throw new Error('緊急投稿: アイテム取得失敗');
  await postItems(items, 'emergency', '緊急回復投稿');
}

// ─── 芸能人スロット専用：投稿処理 ────────────────────────────────────────────

async function postCelebrityItem(item: any, label: string, mapping: CelebrityMapping) {
  const hook = pickRandom(mapping.hooks);
  const introLine = pickRandom(mapping.introLines);

  console.log(`  🎭 [${label}] 芸能人スロット: ${mapping.celebrity} → "${hook.slice(0, 20)}..."`);

  // ツイート①：芸能人フック + 女優サンプル画像（Claude AI生成）
  const mainText = await generateCelebrityMainTweet(mapping.celebrity, hook, item);
  const imageUrls = getSampleImages(item);
  const mediaIds = await uploadImages(imageUrls);
  const tweetId = await postTweet(mainText, mediaIds);

  // リプライ①：女優紹介（30〜90秒後、Claude AI生成）
  await randomSleep(30, 90);
  const introText = await generateCelebrityIntroReply(introLine, item);
  const introReplyId = await replyToTweet(tweetId, introText);

  // リプライ②：アフィリエイトリンク（20〜60秒後）
  await randomSleep(20, 60);
  const reviewAvg2 = parseFloat(item.review?.average ?? '0');
  const reviewCount2 = item.review?.count ?? 0;
  const isHighScore2 = reviewAvg2 >= 4.3 && reviewCount2 >= 25;
  const affiliateURL = await resolveShortUrl(
    item.affiliateURL ?? '',
    isHighScore2 ? (item.content_id ?? item.id) : undefined,
    isHighScore2 ? item.title : undefined,
  );
  if (!isHighScore2) console.log(`  ℹ️  [Rebrandly] 低スコア (★${reviewAvg2}/${reviewCount2}件) → 元のURLを使用`);
  await replyToTweet(introReplyId, `🔗 作品ページはこちら👇\n${affiliateURL}`);

  recordPost({ tweetId, replyId: introReplyId, item, text: mainText, type: 'celebrity' });
  console.log(`  ✅ [${label}] 芸能人スロット投稿完了 (${tweetId})`);

  // Google Sheets に自動記入
  if (isSheetsConfigured()) {
    appendPostLog({
      postedAt: new Date().toISOString(),
      celebrity: mapping.celebrity,
      itemTitle: item.title,
      tweetText: mainText,
      tweetId,
      postType: 'celebrity',
    }).catch(() => {});
  }
}

export async function postCelebritySlotNow(label: string) {
  return postCelebritySlot(label);
}

async function postCelebritySlot(label: string) {
  if (isPosting) {
    console.log(`  ⚠ [${label}] 前の投稿処理が進行中 — スキップ`);
    return;
  }
  isPosting = true;
  _postingStartedAt = Date.now();
  try {
    const jst = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    console.log(`\n[${jst}] ${label} 芸能人スロット開始`);
    const mapping = pickCelebrity();
    const items = await getCelebrityLikeItems(mapping, 1);
    if (items.length === 0) {
      console.warn(`  ⚠ [${label}] 対象作品が見つかりませんでした`);
      return;
    }
    await postCelebrityItem(items[0], label, mapping);
  } catch (e: any) {
    console.error(`  ❌ [${label}] エラー: ${e.message}`);
    await contact.postingFailed(label, e.message);
  } finally {
    isPosting = false;
    _postingStartedAt = null;
  }
}

// ─── インプ狙い投稿スロット（アフィリリンクなし）────────────────────────────
//
// 有益6：共感2：宣伝2 の比率を実現するため、
// 1日2本の「非宣伝ツイート」を追加する。
// 内容はランダム選択されたテンプレートを使用（人間的な会話感を演出）。

async function postImpressionSlot(label: string) {
  if (isPosting) {
    console.log(`  ⚠ [${label}] 前の投稿処理が進行中 — スキップ`);
    return;
  }
  isPosting = true;
  _postingStartedAt = Date.now();
  try {
    const jst = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    console.log(`\n[${jst}] ${label} インプ狙い投稿開始`);
    const text = generateImpressionTweet();
    const tweetId = await postTweet(text, []);
    // ① 投稿記録（item なし: アフィリリンクなしの純粋な会話投稿）
    recordPost({ tweetId, replyId: '', text, type: 'impression' });
    console.log(`  ✅ [${label}] インプ狙い投稿完了 (${tweetId})`);
  } catch (e: any) {
    console.error(`  ❌ [${label}] エラー: ${e.message}`);
    await contact.postingFailed(label, e.message);
  } finally {
    isPosting = false;
    _postingStartedAt = null;
  }
}

// ─── 常時監視ループ（間隔は戦略エンジンが動的に調整）────────────────────────

async function monitoringLoop() {
  const jst = () => new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  while (true) {
    const intervalMs = getMonitorIntervalMs();
    const intervalH = Math.round(intervalMs / 3600000 * 10) / 10;

    try {
      if (isPosting) {
        console.log(`\n[${jst()}] 📡 監視スキップ（投稿処理中）`);
      } else {
        console.log(`\n[${jst()}] 📡 外部パターン監視サイクル開始`);
        const newPatterns = await refreshExternalPatterns();
        console.log(`[${jst()}] 📡 監視サイクル完了 → 次回は${intervalH}時間後`);

        // 戦略エンジン：仮説検証 → 自動パラメータ調整
        await evaluateAndAdapt(newPatterns ?? 0);
      }
    } catch (e: any) {
      console.error(`  ❌ 監視サイクルエラー: ${e.message}`);
    }

    await sleep(intervalMs);
  }
}

// ─── A/Bテスト週判定 ──────────────────────────────────────────────────────────
// W1 (4/7-4/13): 20:00 JST のみ（プライムタイム）
// W2 (4/14-4/20): 05:00 JST のみ
// W3以降: 通常の動的スロット (18-22 JST) に戻す

function getABTestWeek(): 'W1' | 'W2' | 'normal' {
  const nowJst = new Date(Date.now() + 9 * 3600000);
  const dateKey = nowJst.toISOString().slice(0, 10);
  if (dateKey >= '2026-04-07' && dateKey <= '2026-04-13') return 'W1';
  if (dateKey >= '2026-04-14' && dateKey <= '2026-04-20') return 'W2';
  return 'normal';
}

// ─── 取りこぼしスロット補完（起動時 + 定期チェック）────────────────────────
// 対策: デプロイ・開発再起動でcronが消えても最大6h以内なら自動補完
// A/Bテスト週: 当日スロット時刻を判定して補完 (ウィンドウ: 6h)
// 通常週: 動的芸能人スロット (20:00前後) の取りこぼしのみ補完

// 補完失敗時に30分後に再試行するためのフラグ
let _catchUpRetryScheduled = false;

async function catchUpMissedSlots(isRetry = false) {
  const nowUtc = Date.now();
  const jstOffset = 9 * 60 * 60 * 1000;
  const nowJst = new Date(nowUtc + jstOffset);
  const todayKey = nowJst.toISOString().slice(0, 10);

  const todayMidnightJst = new Date(
    Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate()) - jstOffset,
  );

  const jst = () => new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const week = getABTestWeek();
  const retryTag = isRetry ? ' [リトライ]' : '';

  // A/Bテスト週: 今日の投稿済みフラグがあればスキップ
  if (week === 'W1' || week === 'W2') {
    if (getCelebPostedDate() === todayKey) {
      console.log(`  ✅ [補完チェック${retryTag}] ${week} 本日分投稿済み → スキップ`);
      return;
    }
    // A/Bテスト週の補完対象スロット時刻 (W1: 20:00 JST / W2: 05:00 JST)
    const slotHour = week === 'W1' ? 20 : 5;
    const slotMin  = week === 'W1' ?  0 : 0;
    const slotTime = new Date(todayMidnightJst.getTime() + (slotHour * 60 + slotMin) * 60 * 1000);
    const slotPastMs = nowUtc - slotTime.getTime();
    if (slotPastMs < 0) {
      console.log(`  ℹ️  [補完チェック${retryTag}] ${week} スロットはまだ先 → スキップ`);
      return;
    }
    // ⬆ ウィンドウ 4h → 6h に延長（デプロイ直後の長めのダウンにも対応）
    if (slotPastMs > 6 * 60 * 60 * 1000) {
      console.log(`  ℹ️  [補完チェック${retryTag}] ${week} スロットから6時間超過 → スキップ`);
      return;
    }
    console.log(`\n[${jst()}] ⚡ 取りこぼし検出${retryTag}: ${week} スロット → 補完投稿会議開始`);
    setCelebPostedDate(todayKey);
    try {
      const result = await runMeetingAndPost({ bypassDailyLimit: true });
      if (result.posted) {
        console.log(`  ✅ [補完投稿会議] 投稿完了: ${result.tweetId}`);
        _catchUpRetryScheduled = false;
      } else {
        console.log(`  ℹ️  [補完投稿会議] スキップ: ${result.reason ?? '不明'}`);
      }
    } catch (e: any) {
      console.error(`  ❌ 補完投稿会議失敗 [${week}スロット]: ${e.message}`);
      // 失敗時: まだ6hウィンドウ内なら30分後に1回だけリトライ
      if (!_catchUpRetryScheduled && slotPastMs < 5.5 * 60 * 60 * 1000) {
        _catchUpRetryScheduled = true;
        console.log(`  ♻️  [補完リトライ] 30分後に再試行をスケジュール`);
        sleep(30 * 60 * 1000).then(() => {
          _catchUpRetryScheduled = false;
          catchUpMissedSlots(true);
        });
      }
    }
    return;
  }

  // 通常週: 18-22時スロットの取りこぼしチェック
  const celebSlotHour = 20;
  const slotTime = new Date(todayMidnightJst.getTime() + celebSlotHour * 60 * 60 * 1000);
  const slotPastMs = nowUtc - slotTime.getTime();
  if (slotPastMs < 0) {
    console.log(`  ℹ️  [補完チェック${retryTag}] 投稿会議スロットはまだ先 → スキップ`);
    return;
  }
  if (slotPastMs > 6 * 60 * 60 * 1000) {
    console.log(`  ℹ️  [補完チェック${retryTag}] 投稿会議スロットから6時間超過 → スキップ`);
    return;
  }
  const celebPostsAfter = getPostsAfter(slotTime).filter((p: any) => p.type === 'celebrity' || p.type === 'meeting-post');
  if (celebPostsAfter.length > 0) {
    console.log(`  ✅ [補完チェック${retryTag}] 本日投稿済み確認 → スキップ`);
    return;
  }
  console.log(`\n[${jst()}] ⚡ 取りこぼし検出${retryTag}: 通常週スロット → 補完投稿会議開始`);
  try {
    const result = await runMeetingAndPost();
    if (result.posted) {
      console.log(`  ✅ [補完投稿会議] 投稿完了: ${result.tweetId}`);
    }
  } catch (e: any) {
    console.error(`  ❌ 補完投稿会議失敗: ${e.message}`);
  }
}

export function startScheduler() {
  // ── 戦略設定を読み込んでから起動 ─────────────────────────────────────────
  loadStrategyConfig().catch((e: any) =>
    console.warn('  ⚠ 戦略設定読み込み失敗 (デフォルト値で動作):', e.message),
  );

  // ── Codexエージェントのスケジューラーオーバーライドを読み込む ──────────────
  loadSchedulerOverrides().catch((e: any) =>
    console.warn('  ⚠ Codexスケジューラーオーバーライド読み込み失敗:', e.message),
  );

  // ── Google Sheets 設定状態をログに出力 + ヘッダー自動初期化 ──────────────
  if (isSheetsConfigured()) {
    console.log('  📊 [Sheets] Google Sheets 連携: 有効 (6タブ自動転記: PostLog / DecisionLog / AccountMetrics / Hypotheses / MeetingLog / AlgoInsights)');
    // ヘッダーは冪等なので毎起動時に安全に初期化
    sleep(30 * 1000).then(() =>
      initSheetHeaders().catch((e: any) =>
        console.warn('  ⚠ [Sheets] ヘッダー初期化失敗:', e.message),
      ),
    );
  } else {
    console.log('  ℹ️  [Sheets] Google Sheets 連携: 未設定 (GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_SHEET_ID が必要)');
  }

  // ── ウォッチドッグにスケジューラーフックを注入して起動 ────────────────────
  injectSchedulerHooks({
    getIsPosting,
    getPostingStartedAt,
    forceResetIsPosting,
    triggerEmergencyPost,
  });
  sleep(3 * 60 * 1000).then(() => startWatchdog()); // 3分後に初回チェック

  // ── 常時監視ループを起動（5分後に初回実行）── クラッシュ時は5分後に自動再起動
  async function startMonitoringLoop() {
    await sleep(5 * 60 * 1000);
    while (true) {
      try {
        await monitoringLoop();
      } catch (e: any) {
        console.error(`  ❌ 監視ループが異常終了: ${e.message} — 5分後に再起動します`);
        await sleep(5 * 60 * 1000);
      }
    }
  }
  startMonitoringLoop();

  // ── 起動2分後に取りこぼしチェック ───────────────────────────────────────
  sleep(2 * 60 * 1000).then(() => catchUpMissedSlots());

  // ── 30分ごとの定期補完チェック ────────────────────────────────────────
  // デプロイ・再起動でcronが消えた場合でも最大30分以内に自動復旧
  // 深夜〜早朝 (W2スロット 05:00前後) にも対応するため全時間帯で実行
  cron.schedule('*/30 * * * *', async () => {
    try {
      await catchUpMissedSlots();
    } catch (e: any) {
      console.warn('  ⚠ [30min補完チェック] エラー:', e.message);
    }
  }, { timezone: 'Asia/Tokyo' });

  // ── 起動10分後にキャンペーンID探索（キャッシュが新鮮な場合はスキップ）──
  sleep(10 * 60 * 1000).then(() =>
    discoverCampaignIds({ maxProbe: 200 }).catch((e: any) =>
      console.warn('  ⚠ キャンペーンID探索失敗:', e.message),
    ),
  );

  // 毎週日曜 03:00 JST — キャンペーンID週次再探索（次の範囲を探索）
  cron.schedule('0 3 * * 0', async () => {
    console.log('\n  🔄 [週次] キャンペーンID再探索開始');
    await discoverCampaignIds({ maxProbe: 300 }).catch((e: any) =>
      console.warn('  ⚠ キャンペーンID週次探索失敗:', e.message),
    );
    autoCompleteTask('weekly-campaign-scan', 'weekly').catch(() => {});
  }, { timezone: 'Asia/Tokyo' });

  // ── 投稿スケジュール（シャドウバン回復 A/Bテストモード）─────────────────────
  // 設計方針: 1日1件に絞り信頼スコアを回復しながらスロット最適化テストを実施
  //   W1 (4/7-4/13):  20:00 JST のみ（プライムタイム）→ 芸能人アフィリ1本
  //   W2 (4/14-4/20): 05:00 JST のみ → 芸能人アフィリ1本
  //   W3以降:          動的 (18-22 JST) に戻す
  // ※ 合計: 1本/日（A/Bテスト期間）

  // 04:40 JST — W2専用 投稿会議（05:00投稿目標）
  // 投稿会議（Phase 1-4）を開始 → Grok裁定ツイートを05:00前後にX投稿
  cron.schedule('40 4 * * *', async () => {
    const week = getABTestWeek();
    if (week !== 'W2') {
      console.log(`  ℹ️  [04:40 W2投稿会議] ${week}期間外 → スキップ`);
      return;
    }
    const todayKey = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    if (getCelebPostedDate() === todayKey) {
      console.log(`  ℹ️  [04:40 W2投稿会議] 本日投稿済み → スキップ`);
      return;
    }
    setCelebPostedDate(todayKey); // 会議開始前にフラグ立て（重複防止）
    console.log('\n  🎙 [04:40 W2投稿会議] Phase 1-4 投稿会議開始...');
    const result = await runMeetingAndPost();
    if (result.posted) {
      console.log(`  ✅ [W2投稿会議] 投稿完了: ${result.tweetId}`);
    } else {
      console.log(`  ℹ️  [W2投稿会議] スキップ: ${result.reason ?? '不明'}`);
    }
    autoCompleteTask('daily-celeb-post', 'daily').catch(() => {});
  }, { timezone: 'Asia/Tokyo' });

  // 19:40 JST — W1=投稿会議（20:00投稿目標・プライムタイム）/ 通常週=投稿会議①
  // 投稿会議（Phase 1-4）を開始 → Grok裁定ツイートを20:00前後にX投稿
  cron.schedule('40 19 * * *', async () => {
    const week = getABTestWeek();
    const todayKey = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    if (week === 'W1') {
      if (getCelebPostedDate() === todayKey) {
        console.log(`  ℹ️  [19:40 W1投稿会議] 本日投稿済み → スキップ`);
        return;
      }
      setCelebPostedDate(todayKey); // 会議開始前にフラグ立て
      console.log('\n  🎙 [19:40 W1投稿会議] Phase 1-4 投稿会議開始...（プライムタイム 20:00目標）');
      const result = await runMeetingAndPost();
      if (result.posted) {
        console.log(`  ✅ [W1投稿会議] 投稿完了: ${result.tweetId}`);
      } else {
        console.log(`  ℹ️  [W1投稿会議] スキップ: ${result.reason ?? '不明'}`);
      }
      autoCompleteTask('daily-celeb-post', 'daily').catch(() => {});
    } else if (week === 'W2') {
      // W2: 19:40は使わない (04:40スロット担当)
      console.log(`  ℹ️  [19:40スロット] W2期間中 → スキップ (04:40スロット担当)`);
    } else {
      // 通常週: 投稿会議①
      console.log('\n  🎙 [19:40 投稿会議①] Phase 1-4 投稿会議開始...');
      const result = await runMeetingAndPost();
      if (result.posted) {
        console.log(`  ✅ [投稿会議①] 投稿完了: ${result.tweetId}`);
      }
      autoCompleteTask('daily-imp-post', 'daily').catch(() => {});
    }
  }, { timezone: 'Asia/Tokyo' });

  // 16:40 JST — 投稿会議②（通常週のみ、17:00投稿目標）
  // 投稿会議（Phase 1-4）を開始 → Grok裁定ツイートを17:00前後にX投稿
  cron.schedule('40 16 * * *', async () => {
    const week = getABTestWeek();
    if (week === 'W1' || week === 'W2') {
      console.log(`  ℹ️  [16:40 投稿会議②] ${week}期間中 → スキップ`);
      return;
    }
    console.log('\n  🎙 [16:40 投稿会議②] Phase 1-4 投稿会議開始...');
    const result = await runMeetingAndPost();
    if (result.posted) {
      console.log(`  ✅ [投稿会議②] 投稿完了: ${result.tweetId}`);
    }
    autoCompleteTask('daily-imp2-post', 'daily').catch(() => {});
  }, { timezone: 'Asia/Tokyo' });

  // 09:00 JST — 日次フォロワースナップショット + 増減アラート
  cron.schedule('0 9 * * *', async () => {
    try {
      const prev = getLatestSnapshot();
      const info = await getAccountInfo();
      if (!info) return;
      recordAccountSnapshot({ followersCount: info.followersCount, followingCount: info.followingCount, tweetCount: info.tweetCount, note: '日次自動記録' });
      if (prev) {
        const delta = info.followersCount - prev.followersCount;
        const hoursSince = (Date.now() - new Date(prev.recordedAt).getTime()) / 3600000;
        // 直近24±4時間以内のスナップと比較したときのみアラート
        if (hoursSince < 28 && Math.abs(delta) >= 5) {
          await contact.followerChange(info.followersCount, prev.followersCount, delta);
        }
        console.log(`  📊 [日次スナップ] フォロワー: ${info.followersCount}人 (${delta >= 0 ? '+' : ''}${delta}人)`);
      }

      // ── Sheets: AccountMetrics 書き込み ──────────────────────────────────
      if (isSheetsConfigured()) {
        const snaps = getDailyImpressionSnapshots(7);
        const avgImp = snaps.length > 0
          ? Math.round(snaps.reduce((a, b) => a + b.avgImpressions, 0) / snaps.length)
          : 0;
        const nowJst = new Date(Date.now() + 9 * 3600000);
        const todayStart = new Date(Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate()) - 9 * 3600000);
        const todayPosts = getPostsAfter(todayStart).length;
        await appendAccountMetrics({
          recordedAt:      new Date().toISOString(),
          followersCount:  info.followersCount,
          followingCount:  info.followingCount,
          tweetCount:      info.tweetCount,
          avgImpressions:  avgImp,
          totalPostsToday: todayPosts,
          note:            '日次自動記録',
        }).catch((e: any) => console.warn('  ⚠ [Sheets] AccountMetrics書き込み失敗:', e.message));
      }
    } catch (e: any) {
      console.warn('  ⚠ 日次スナップ失敗:', e.message);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 月曜 04:00 JST — 🤝 週次自律AI会議（GPT×Claude議論→決定→自動実行）
  // 【頭】週次戦略会議: 情報収集 → 議論 → strategy/template更新
  cron.schedule('0 4 * * 1', async () => {
    console.log('\n  🤝 [自律会議] 週次AI会議を自動実行中...');
    try {
      const result = await runAutonomousMeeting();
      console.log(`  ✅ [自律会議] 完了: 自動実行${result.autoExecuted.length}件 / 手動確認${result.manualItems.length}件`);
    } catch (e: any) {
      console.error(`  ❌ [自律会議] エラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 火・木 20:00 JST — 🎙→🚀 会議→投稿サイクル（頭→手）
  // W1/W2期間（専用スロット担当 & setCelebPostedDate済み）→ スキップ
  // W3以降 or 本日未投稿       → 会議 → Grok裁定ツイート → X即時投稿
  cron.schedule('0 20 * * 2,4', async () => {
    const week = getABTestWeek();
    const todayKey = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    // W1/W2期間は専用スロットcron（19:40/04:40）が担当。celebPostedDateが設定済みならスキップ
    if ((week === 'W1' || week === 'W2') && getCelebPostedDate() === todayKey) {
      console.log(`  ℹ️  [20:00 火/木会議] ${week}期間・本日投稿会議開始済み → スキップ（専用スロット担当）`);
      return;
    }
    console.log('\n  🎙 [会議→投稿] 火/木 自律フルサイクル開始...');
    try {
      const result = await runMeetingAndPost();
      if (result.posted) {
        console.log(`  ✅ [会議→投稿] 投稿完了: ${result.tweetId}`);
      } else {
        console.log(`  ℹ️  [会議→投稿] 情報収集完了（投稿スキップ: ${result.reason ?? '制限'}）`);
      }
    } catch (e: any) {
      console.error(`  ❌ [会議→投稿] エラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 土曜 21:00 JST — 🎙→🚀 週末会議→投稿サイクル（頭→手）
  // 週末のXアクティブ時間帯に合わせた自律投稿
  cron.schedule('0 21 * * 6', async () => {
    const week = getABTestWeek();
    const todayKey = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    if ((week === 'W1' || week === 'W2') && getCelebPostedDate() === todayKey) {
      console.log(`  ℹ️  [21:00 土曜会議] ${week}期間・本日投稿会議開始済み → スキップ`);
      return;
    }
    console.log('\n  🎙 [会議→投稿] 土曜 自律フルサイクル開始...');
    try {
      const result = await runMeetingAndPost();
      if (result.posted) {
        console.log(`  ✅ [会議→投稿] 投稿完了: ${result.tweetId}`);
      } else {
        console.log(`  ℹ️  [会議→投稿] 情報収集完了（投稿スキップ: ${result.reason ?? '制限'}）`);
      }
    } catch (e: any) {
      console.error(`  ❌ [会議→投稿] エラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 毎朝 07:30 JST — 🤖 会議室決定事項の完全自動実行（全権委任モード）
  cron.schedule('30 7 * * *', async () => {
    console.log('\n  🤖 [自律実行] 会議室決定事項の自動実行開始...');
    try {
      const result = await runAutoDirectiveExecution();
      console.log(`  ✅ [自律実行] 完了: ${result.succeeded}/${result.total}件成功 (skip:${result.skipped})`);
    } catch (e: any) {
      console.error(`  ❌ [自律実行] エラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 日曜 23:30 JST — Xアルゴリズム週次自動解析 + 推奨自動適用
  cron.schedule('30 23 * * 0', async () => {
    console.log('\n  🔬 [アルゴ解析] 週次自動実行開始');
    try {
      const insight = await runAlgoAnalysis();
      console.log('  ✅ [アルゴ解析] 完了');
      await contact.algoWeeklyBriefing(insight.briefing, insight.sampleSize);

      // 🤖 アルゴ推奨を自動適用
      console.log('  🤖 [アルゴ自動適用] 推奨を戦略設定に反映中...');
      const applyResult = await applyAlgoRecommendations(insight.briefing, insight.discussion);
      if (applyResult.applied) {
        console.log(`  ✅ [アルゴ自動適用] ${applyResult.summary}`);
        await contact.systemAlert('🤖 アルゴ推奨自動適用', applyResult.summary);
      }

      // ── Sheets: AlgoInsights 書き込み ────────────────────────────────────
      if (isSheetsConfigured()) {
        await appendAlgoInsight({
          generatedAt:     new Date().toISOString(),
          sampleSize:      insight.sampleSize ?? 0,
          briefingSummary: (insight.briefing ?? '').slice(0, 200),
        }).catch((e: any) => console.warn('  ⚠ [Sheets] AlgoInsights書き込み失敗:', e.message));
      }
    } catch (e: any) {
      console.error(`  ❌ [アルゴ解析] エラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 4/21 以降 月曜 09:00 JST — 🧪 A/Bテスト自動判定（W1 vs W2）
  cron.schedule('0 9 * * 1', async () => {
    const now = new Date();
    const w2End = new Date('2026-04-20T23:59:59+09:00');
    if (now <= w2End) return; // W2終了前はスキップ
    try {
      console.log('\n  🧪 [A/Bテスト判定] 自動評価開始...');
      const decision = await runABTestDecision();
      if (decision) {
        console.log(`  ✅ [A/Bテスト] 勝者: ${decision.winner} (${decision.winnerTime})`);
      }
    } catch (e: any) {
      console.error(`  ❌ [A/Bテスト判定] エラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 月曜 08:30 JST — Xアルゴリズム最新情報収集（週次解析の翌朝）
  cron.schedule('30 8 * * 1', async () => {
    console.log('\n  📡 [アルゴニュース] 週次情報収集開始');
    try {
      const found = await collectAlgoNews();
      const pending = found.filter(d => d.status === 'pending').length;
      console.log(`  ✅ [アルゴニュース] ${found.length}件収集 / 要確認: ${pending}件`);
      if (pending > 0) {
        await contact.algoNewsAlert(pending, found.slice(0, 3));
      }
    } catch (e: any) {
      console.error(`  ❌ [アルゴニュース] エラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 06:00 JST — Rebrandlyクリック数自動同期
  cron.schedule('0 6 * * *', async () => {
    try {
      const result = await syncRebrandlyClicks();
      if (result) {
        console.log(`  🔗 [Rebrandly] 同期完了: ${result.synced}件 / 総クリック ${result.totalClicks}`);
      }
    } catch (e: any) {
      console.warn('  ⚠ Rebrandly同期失敗:', e.message);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 毎日 08:00 JST — タイムライン自動同期（直近50件を検証データに取込）
  cron.schedule('0 8 * * *', async () => {
    console.log('\n  🔄 [タイムライン自動同期] 開始...');
    try {
      const tweets = await getOwnRecentTweets(50);
      let newCount = 0;
      let updatedCount = 0;
      for (const t of tweets) {
        const { isNew } = recordPostManual({
          tweetId: t.id,
          text: t.text,
          postedAt: (t as any).created_at ?? new Date().toISOString(),
          metrics: (t.public_metrics as any) ?? null,
        });
        if (isNew) newCount++; else updatedCount++;
      }
      console.log(`  ✅ [タイムライン自動同期] 新規: ${newCount}件 / 更新: ${updatedCount}件（計${tweets.length}件）`);
    } catch (e: any) {
      console.warn(`  ⚠ [タイムライン自動同期] 失敗: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 毎日 23:00 JST — シャドウバン回復自動チェック（③）
  cron.schedule('0 23 * * *', async () => {
    try {
      await checkShadowbanRecovery();
      autoCompleteTask('daily-shadowban-check', 'daily').catch(() => {});
    } catch (e: any) {
      console.error(`  ❌ 回復チェックエラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 毎日 23:10 JST — 投稿指標更新（W2以降: 4/14〜）
  // 予算: 7件 × $0.005 = $0.035/日
  cron.schedule('10 23 * * *', async () => {
    const nowJst = new Date(Date.now() + 9 * 3600000);
    const dateKey = nowJst.toISOString().slice(0, 10);
    if (dateKey < '2026-04-14') {
      return; // W1期間中はスキップ（クレジット節約）
    }
    console.log('\n  📊 [指標更新] 23:10 自動実行開始');
    try {
      await refreshRecentMetrics();
      console.log('  ✅ [指標更新] 完了');
    } catch (e: any) {
      console.error(`  ❌ [指標更新] エラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 毎日 03:00 JST — 日次戦略評価
  cron.schedule('0 3 * * *', async () => {
    console.log('\n  🌙 [日次評価] 夜間自律改善サイクル開始');
    try {
      await runDailyEvaluation();

      // ── Sheets: Hypotheses 全上書き ───────────────────────────────────────
      if (isSheetsConfigured()) {
        const strategy = getStrategySummary();
        if ((strategy.hypotheses ?? []).length > 0) {
          await upsertHypotheses(
            strategy.hypotheses.map((h: any) => ({
              id:         h.id,
              question:   h.question,
              status:     h.status,
              finding:    h.finding ?? '',
              adjustment: h.adjustment ?? '',
              testedAt:   h.testedAt ?? new Date().toISOString(),
            })),
          ).catch((e: any) => console.warn('  ⚠ [Sheets] Hypotheses書き込み失敗:', e.message));
        }
      }
    } catch (e: any) {
      console.error(`  ❌ 日次評価エラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 月曜 08:00 JST — 週次パフォーマンスレポート + アカウントスナップショット
  cron.schedule('0 8 * * 1', async () => {
    const stats = getStats();
    const extInfo = getExternalPatternsInfo();
    const dynInfo = getDynamicTemplatesInfo();

    // フォロワー数スナップショット（回復進捗を追跡）
    try {
      const info = await getAccountInfo();
      if (info) {
        recordAccountSnapshot({
          followersCount: info.followersCount,
          followingCount: info.followingCount,
          tweetCount:     info.tweetCount,
          note: '週次自動記録',
        });
      }
    } catch (e: any) {
      console.warn('  ⚠ フォロワースナップショット失敗:', e.message);
    }

    // Rebrandlyサマリーを週次レポートに追加
    const rbData = getRebrandlyData();
    const rbTotalClicks = rbData.links.reduce((s, l) => s + l.clicks, 0);
    if (rbData.links.length > 0) {
      const topLinks = [...rbData.links].sort((a, b) => b.clicks - a.clicks).slice(0, 3)
        .map(l => ({ title: l.title, clicks: l.clicks }));
      await contact.rebrandlyWeeklySummary(rbTotalClicks, topLinks);
    }

    // ── 週次メトリクスレポート（スプレッドシート代替・IPF自動計算含む）──
    try {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const weekPosts = getPostsAfter(weekAgo);
      if (weekPosts.length > 0) {
        const metricsRows: MetricsReportPost[] = weekPosts.map(p => {
          const imp = p.metrics?.impression_count ?? 0;
          const likes = p.metrics?.like_count ?? 0;
          const rt = p.metrics?.retweet_count ?? 0;
          // Rebrandlyクリック数：destinationURLで照合
          const rbLink = rbData.links.find(l => l.destination === p.item?.affiliateURL);
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
        const avgImp = totalImp / metricsRows.length;
        const now = new Date();
        const startDate = weekAgo.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
        const endDate = now.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
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
        console.log(`  ✅ 週次メトリクスレポート送信完了 (${metricsRows.length}件 / 平均IPF: ${avgImp.toFixed(1)})`);
      } else {
        console.log('  ℹ️  週次メトリクスレポート: 対象投稿なし（スキップ）');
      }
    } catch (e: any) {
      console.warn('  ⚠ 週次メトリクスレポート生成失敗:', e.message);
    }

    await contact.weeklyReport({
      投稿統計: stats,
      外部パターン: { 総数: extInfo.count, 最終更新: extInfo.lastRefreshedAt },
      動的テンプレート: { 総数: dynInfo.count, 進化回数: dynInfo.evolutionCount, 最終進化: dynInfo.lastEvolvedAt },
      Rebrandly: { リンク数: rbData.links.length, 総クリック: rbTotalClicks, 最終同期: rbData.lastSyncedAt },
    });

    // 手動投稿の週次フィードバック生成
    try {
      console.log('  📝 手動投稿フィードバック生成中...');
      const fb = await buildManualPostFeedback(7);
      if (fb) {
        const saved = recordManualFeedback(fb);
        await contact.manualPostFeedback(saved);
        console.log(`  ✅ 手動投稿FB完了: ${fb.tweetCount}件分析, avg ${fb.avgEngagement}pt`);
      } else {
        console.log('  ℹ️  手動投稿FB: 対象ツイートなし（スキップ）');
      }
    } catch (e: any) {
      console.warn('  ⚠ 手動投稿FB生成失敗:', e.message);
    }

    autoCompleteTask('weekly-perf-report', 'weekly').catch(() => {});
    autoCompleteTask('weekly-external-monitor', 'weekly').catch(() => {});
  }, { timezone: 'Asia/Tokyo' });

  // 投稿会議③ — 18〜22時を毎時チェック（通常週のみ）
  // A/Bテスト週 (W1/W2) はスキップ（専用スロット担当）
  // 最適投稿時間帯に投稿会議（Phase 1-4）を開始 → Grok裁定ツイートを即投稿
  cron.schedule('0 18,19,20,21,22 * * *', async () => {
    const week = getABTestWeek();
    if (week === 'W1' || week === 'W2') {
      console.log(`  ℹ️  [18-22投稿会議③] ${week}期間中 → スキップ (専用スロット担当)`);
      return;
    }
    const nowJst = new Date(Date.now() + 9 * 3600000);
    const todayKey = nowJst.toISOString().slice(0, 10);
    if (getCelebPostedDate() === todayKey) {
      console.log(`  ℹ️  [18-22投稿会議③] 本日投稿済み (${todayKey}) → スキップ`);
      return;
    }
    const rawBest = getBestPostingHour();
    const bestHour = (rawBest >= 18 && rawBest <= 22) ? rawBest : 20;
    const currentHour = nowJst.getUTCHours();
    if (currentHour !== bestHour) {
      console.log(`  ℹ️  [18-22投稿会議③] 現在${currentHour}時 / 最適${bestHour}時 → スキップ`);
      return;
    }
    setCelebPostedDate(todayKey); // 会議開始前にフラグ立て（重複防止）
    console.log(`\n  🎙 [${String(bestHour).padStart(2, '0')}:00 投稿会議③] Phase 1-4 投稿会議開始...`);
    const result = await runMeetingAndPost();
    if (result.posted) {
      console.log(`  ✅ [投稿会議③] 投稿完了: ${result.tweetId}`);
    } else {
      console.log(`  ℹ️  [投稿会議③] スキップ: ${result.reason ?? '不明'}`);
    }
    autoCompleteTask('daily-celeb-post', 'daily').catch(() => {});
  }, { timezone: 'Asia/Tokyo' });

  // 起動時に投稿状況を表示
  const loadedCelebDate = getCelebPostedDate();
  if (loadedCelebDate) {
    console.log(`  ℹ️  [起動] 芸能人スロット投稿済み日付を読み込み: ${loadedCelebDate}`);
  }

  const currentWeek = getABTestWeek();
  const weekLabel = currentWeek === 'W1' ? 'W1: 20:00 JST のみ（プライムタイム）' : currentWeek === 'W2' ? 'W2: 05:00 JST のみ' : '動的 (18-22 JST)';
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  FANZA X Bot【新アカウント育成モード】   ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  🌱 Phase-0: 信頼スコア積み上げ期間      ║');
  console.log('║  🧪 1日1件 A/Bテストモード               ║');
  console.log(`║  🎭 ${weekLabel.padEnd(35)}║`);
  console.log('║  📡 外部監視    : 常時ループ              ║');
  console.log('║  🔄 TL自動同期  : 08:00 JST              ║');
  console.log('║  📊 SBIチェック : 23:00 JST              ║');
  console.log('║  🌙 日次評価    : 03:00 JST              ║');
  console.log('║  計: 芸能人アフィリ1本 = 1本/日          ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
}
