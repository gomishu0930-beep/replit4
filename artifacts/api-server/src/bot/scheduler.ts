import cron from 'node-cron';

import { getRandomItems, getSampleImages, discoverCampaignIds } from './fanza.js';
import { uploadImages, postTweet, replyToTweet, getAccountInfo } from './twitter.js';
import { generateTweetText, generateEngagementReply, generateCelebrityMainTweet, generateCelebrityIntroReply, generateImpressionTweet, getLastContentType, buildManualPostFeedback } from './ai.js';
import { recordPost, getTopPatterns, getExternalTopPatterns, getPostsAfter, getStats, getDynamicTemplatesInfo, getExternalPatternsInfo, recordAccountSnapshot, getCelebPostedDate, setCelebPostedDate, recordManualFeedback, getLatestSnapshot, getRebrandlyData } from './storage.js';
import { syncRebrandlyClicks, resolveShortUrl } from './rebrandly.js';
import { runAlgoAnalysis } from './algo.js';
import { refreshExternalPatterns, checkShadowbanRecovery } from './analytics.js';
import { pickCelebrity, pickRandom, getBestPostingHour, getCelebrityLikeItems, CelebrityMapping } from './celebrity.js';
import { contact } from './contact.js';
import { loadStrategyConfig, evaluateAndAdapt, runDailyEvaluation, getMonitorIntervalMs } from './strategy.js';
import { startWatchdog, injectSchedulerHooks } from './watchdog.js';
import { autoCompleteTask } from './tasks.js';

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

  // ツイート①：芸能人フック + 女優サンプル画像
  const mainText = generateCelebrityMainTweet(mapping.celebrity, hook, item);
  const imageUrls = getSampleImages(item);
  const mediaIds = await uploadImages(imageUrls);
  const tweetId = await postTweet(mainText, mediaIds);

  // リプライ①：女優紹介（30〜90秒後）
  await randomSleep(30, 90);
  const introText = generateCelebrityIntroReply(introLine, item);
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
// W1 (4/7-4/13): 10:30 JST のみ
// W2 (4/14-4/20): 05:00 JST のみ
// W3以降: 通常の動的スロット (18-22 JST) に戻す

function getABTestWeek(): 'W1' | 'W2' | 'normal' {
  const nowJst = new Date(Date.now() + 9 * 3600000);
  const dateKey = nowJst.toISOString().slice(0, 10);
  if (dateKey >= '2026-04-07' && dateKey <= '2026-04-13') return 'W1';
  if (dateKey >= '2026-04-14' && dateKey <= '2026-04-20') return 'W2';
  return 'normal';
}

// ─── 取りこぼしスロット補完（起動時チェック）────────────────────────────────
// A/Bテスト週: 当日スロット時刻を判定して補完
// 通常週: 動的芸能人スロット (20:00前後) の取りこぼしのみ補完

async function catchUpMissedSlots() {
  const nowUtc = Date.now();
  const jstOffset = 9 * 60 * 60 * 1000;
  const nowJst = new Date(nowUtc + jstOffset);
  const todayKey = nowJst.toISOString().slice(0, 10);

  const todayMidnightJst = new Date(
    Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate()) - jstOffset,
  );

  const jst = () => new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const week = getABTestWeek();

  // A/Bテスト週: 今日の投稿済みフラグがあればスキップ
  if (week === 'W1' || week === 'W2') {
    if (getCelebPostedDate() === todayKey) {
      console.log(`  ✅ [補完チェック] ${week} 本日分投稿済み → スキップ`);
      return;
    }
    // A/Bテスト週の補完対象スロット時刻
    const slotHour = week === 'W1' ? 10 : 5;
    const slotMin  = week === 'W1' ? 30 : 0;
    const slotTime = new Date(todayMidnightJst.getTime() + (slotHour * 60 + slotMin) * 60 * 1000);
    const slotPastMs = nowUtc - slotTime.getTime();
    if (slotPastMs < 0) {
      console.log(`  ℹ️  [補完チェック] ${week} スロットはまだ先 → スキップ`);
      return;
    }
    if (slotPastMs > 4 * 60 * 60 * 1000) {
      console.log(`  ℹ️  [補完チェック] ${week} スロットから4時間超過 → スキップ`);
      return;
    }
    console.log(`\n[${jst()}] ⚡ 取りこぼし検出: ${week} スロット → 補完投稿開始`);
    setCelebPostedDate(todayKey);
    await postCelebritySlot(`${week} 補完`);
    return;
  }

  // 通常週: 芸能人スロット（動的 20:00前後）の取りこぼしチェック
  const celebSlotHour = 20;
  const slotTime = new Date(todayMidnightJst.getTime() + celebSlotHour * 60 * 60 * 1000);
  const slotPastMs = nowUtc - slotTime.getTime();
  if (slotPastMs < 0) {
    console.log(`  ℹ️  [補完チェック] 芸能人スロットはまだ先 → スキップ`);
    return;
  }
  if (slotPastMs > 6 * 60 * 60 * 1000) {
    console.log(`  ℹ️  [補完チェック] 芸能人スロットから6時間超過 → スキップ`);
    return;
  }
  const celebPostsAfter = getPostsAfter(slotTime).filter((p: any) => p.type === 'celebrity');
  if (celebPostsAfter.length > 0) {
    console.log(`  ✅ [補完チェック] 芸能人スロット投稿済み確認 → スキップ`);
    return;
  }
  console.log(`\n[${jst()}] ⚡ 取りこぼし検出: 芸能人スロット → 補完投稿開始`);
  try {
    await postCelebritySlot('20:00 芸能人（補完）');
  } catch (e: any) {
    console.error(`  ❌ 補完投稿失敗 [芸能人スロット]: ${e.message}`);
  }
}

export function startScheduler() {
  // ── 戦略設定を読み込んでから起動 ─────────────────────────────────────────
  loadStrategyConfig().catch((e: any) =>
    console.warn('  ⚠ 戦略設定読み込み失敗 (デフォルト値で動作):', e.message),
  );

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
  //   W1 (4/7-4/13):  10:30 JST のみ → 芸能人アフィリ1本
  //   W2 (4/14-4/20): 05:00 JST のみ → 芸能人アフィリ1本
  //   W3以降:          動的 (18-22 JST) に戻す
  // ※ 合計: 1本/日（A/Bテスト期間）

  // 05:00 JST — W2専用スロット（週次A/Bテスト）
  cron.schedule('0 5 * * *', async () => {
    const week = getABTestWeek();
    if (week !== 'W2') {
      console.log(`  ℹ️  [05:00スロット] ${week}期間外 → スキップ`);
      return;
    }
    const todayKey = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    if (getCelebPostedDate() === todayKey) {
      console.log(`  ℹ️  [05:00スロット] 本日投稿済み → スキップ`);
      return;
    }
    setCelebPostedDate(todayKey);
    await postCelebritySlot('05:00 W2芸能人');
    autoCompleteTask('daily-celeb-post', 'daily').catch(() => {});
  }, { timezone: 'Asia/Tokyo' });

  // 10:30 JST — W1=芸能人アフィリ / 通常週=インプ狙い（人間的な会話・共感ツイート）
  cron.schedule('30 10 * * *', async () => {
    const week = getABTestWeek();
    const todayKey = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    if (week === 'W1') {
      // W1: 10:30に芸能人アフィリポスト
      if (getCelebPostedDate() === todayKey) {
        console.log(`  ℹ️  [10:30スロット W1] 本日投稿済み → スキップ`);
        return;
      }
      setCelebPostedDate(todayKey);
      await postCelebritySlot('10:30 W1芸能人');
      autoCompleteTask('daily-celeb-post', 'daily').catch(() => {});
    } else if (week === 'W2') {
      // W2: 10:30は使わない (05:00スロット担当)
      console.log(`  ℹ️  [10:30スロット] W2期間中 → スキップ (05:00スロット担当)`);
    } else {
      // 通常週: インプ狙い投稿
      await postImpressionSlot('10:30 インプ');
      autoCompleteTask('daily-imp-post', 'daily').catch(() => {});
    }
  }, { timezone: 'Asia/Tokyo' });

  // 17:00 JST — インプ狙い投稿②（通常週のみ）
  cron.schedule('0 17 * * *', async () => {
    const week = getABTestWeek();
    if (week === 'W1' || week === 'W2') {
      console.log(`  ℹ️  [17:00インプ] ${week}期間中 → スキップ (アフィリ専念)`);
      return;
    }
    await postImpressionSlot('17:00 インプ');
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
    } catch (e: any) {
      console.warn('  ⚠ 日次スナップ失敗:', e.message);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 日曜 23:30 JST — Xアルゴリズム週次自動解析（月曜朝のレポート前に完了）
  cron.schedule('30 23 * * 0', async () => {
    console.log('\n  🔬 [アルゴ解析] 週次自動実行開始');
    try {
      const insight = await runAlgoAnalysis();
      console.log('  ✅ [アルゴ解析] 完了');
      // ブリーフィングを通知
      await contact.algoWeeklyBriefing(insight.briefing, insight.sampleSize);
    } catch (e: any) {
      console.error(`  ❌ [アルゴ解析] エラー: ${e.message}`);
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

  // 毎日 23:00 JST — シャドウバン回復自動チェック（③）
  cron.schedule('0 23 * * *', async () => {
    try {
      await checkShadowbanRecovery();
      autoCompleteTask('daily-shadowban-check', 'daily').catch(() => {});
    } catch (e: any) {
      console.error(`  ❌ 回復チェックエラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 毎日 03:00 JST — 日次戦略評価
  cron.schedule('0 3 * * *', async () => {
    console.log('\n  🌙 [日次評価] 夜間自律改善サイクル開始');
    try {
      await runDailyEvaluation();
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

  // 芸能人アフィリスロット — 18〜22時を毎時チェック（通常週のみ）
  // A/Bテスト週 (W1/W2) はこのスロットをスキップ（専用スロット担当）
  cron.schedule('0 18,19,20,21,22 * * *', async () => {
    const week = getABTestWeek();
    if (week === 'W1' || week === 'W2') {
      console.log(`  ℹ️  [18-22スロット] ${week}期間中 → スキップ (専用スロット担当)`);
      return;
    }
    const nowJst = new Date(Date.now() + 9 * 3600000);
    const todayKey = nowJst.toISOString().slice(0, 10);
    if (getCelebPostedDate() === todayKey) {
      console.log(`  ℹ️  [芸能人スロット] 本日投稿済み (${todayKey}) → スキップ`);
      return;
    }
    const rawBest = getBestPostingHour();
    const bestHour = (rawBest >= 18 && rawBest <= 22) ? rawBest : 20;
    const currentHour = nowJst.getUTCHours();
    if (currentHour !== bestHour) {
      console.log(`  ℹ️  [芸能人スロット] 現在${currentHour}時 / 最適${bestHour}時 → スキップ`);
      return;
    }
    setCelebPostedDate(todayKey);
    await postCelebritySlot(`${String(bestHour).padStart(2, '0')}:00 芸能人`);
    autoCompleteTask('daily-celeb-post', 'daily').catch(() => {});
  }, { timezone: 'Asia/Tokyo' });

  // 起動時に投稿状況を表示
  const loadedCelebDate = getCelebPostedDate();
  if (loadedCelebDate) {
    console.log(`  ℹ️  [起動] 芸能人スロット投稿済み日付を読み込み: ${loadedCelebDate}`);
  }

  const currentWeek = getABTestWeek();
  const weekLabel = currentWeek === 'W1' ? 'W1: 10:30 JST のみ' : currentWeek === 'W2' ? 'W2: 05:00 JST のみ' : '動的 (18-22 JST)';
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  FANZA X Bot【シャドウバン回復モード】   ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  ⚠️  1日1件 A/Bテストモード               ║');
  console.log(`║  🎭 ${weekLabel.padEnd(35)}║`);
  console.log('║  📡 外部監視    : 常時ループ              ║');
  console.log('║  📊 回復チェック: 23:00 JST              ║');
  console.log('║  🌙 日次評価    : 03:00 JST              ║');
  console.log('║  計: 芸能人アフィリ1本 = 1本/日          ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
}
