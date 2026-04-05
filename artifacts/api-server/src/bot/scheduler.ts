import cron from 'node-cron';

import { getHighRatedItems, getSaleItems, getBuzzItems, getRandomItems, getAmateurItems, getSampleImages, discoverCampaignIds } from './fanza.js';
import { uploadImages, postTweet, replyToTweet } from './twitter.js';
import { generateTweetText, generateEngagementReply, generateCelebrityMainTweet, generateCelebrityIntroReply, generateImpressionTweet } from './ai.js';
import { recordPost, getTopPatterns, getExternalTopPatterns, getPostsAfter, getStats, getDynamicTemplatesInfo, getExternalPatternsInfo } from './storage.js';
import { refreshRecentMetrics, refreshExternalPatterns } from './analytics.js';
import { pickCelebrity, pickRandom, getBestPostingHour, getCelebrityLikeItems, CelebrityMapping } from './celebrity.js';
import { contact } from './contact.js';
import { loadStrategyConfig, evaluateAndAdapt, getMonitorIntervalMs } from './strategy.js';
import { startWatchdog, injectSchedulerHooks } from './watchdog.js';

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
  const imageUrls = getSampleImages(item);
  const mediaIds = await uploadImages(imageUrls);
  const tweetId = await postTweet(text, mediaIds);

  // ツイート→リプライ間：30〜90秒待機（人間的な間隔）
  await randomSleep(30, 90);

  const affiliateURL = item.affiliateURL ?? '';
  const replyId = await replyToTweet(tweetId, `🔗 作品ページはこちら👇\n${affiliateURL}`);

  // リプライ1→2間：20〜60秒待機
  await randomSleep(20, 60);

  // 3投目：エンゲージメント誘導リプライ
  const engagementText = generateEngagementReply(type);
  await replyToTweet(replyId, engagementText);

  recordPost({ tweetId, replyId, item, text, type });
  console.log(`  ✅ [${label}] 投稿完了 (${tweetId})`);
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
  const affiliateURL = item.affiliateURL ?? '';
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

// ─── 取りこぼしスロット補完（起動時チェック）────────────────────────────────
interface Slot {
  hour: number;
  minute: number;
  type: string;
  label: string;
  fetchFn: (n: number) => Promise<any[]>;
  extra?: () => Promise<void>;
}

const SLOTS: Slot[] = [
  { hour:  9, minute:  0, type: 'amateur', label: '09:00 素人（補完）',  fetchFn: (n) => getAmateurItems(n) },
  { hour: 12, minute:  0, type: 'buzz',   label: '12:00 高評価（補完）', fetchFn: (n) => getHighRatedItems(n) },
  { hour: 18, minute:  0, type: 'buzz',   label: '18:00 バズ（補完）',   fetchFn: (n) => getBuzzItems(n),
    extra: async () => { await refreshRecentMetrics(); } },
  { hour: 21, minute:  0, type: 'random', label: '21:00 ランダム（補完）', fetchFn: (n) => getRandomItems(n) },
  { hour: 23, minute:  0, type: 'sale',   label: '23:00 セール（補完）',  fetchFn: (n) => getSaleItems(n) },
];
// ※ インプ狙い投稿スロット（10:30 / 17:00）は catchUp 対象外
//   （アフィリ投稿の取りこぼし補完のみ行う）

async function catchUpMissedSlots() {
  const nowUtc = Date.now();
  const jstOffset = 9 * 60 * 60 * 1000;
  const nowJst = new Date(nowUtc + jstOffset);

  const todayMidnightJst = new Date(
    Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate()) - jstOffset,
  );

  const jst = () => new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  for (const slot of SLOTS) {
    const slotTime = new Date(todayMidnightJst.getTime() + (slot.hour * 60 + slot.minute) * 60 * 1000);
    const slotPastMs = nowUtc - slotTime.getTime();

    // スロット未到達、または6時間以上前のものはスキップ
    if (slotPastMs < 0 || slotPastMs > 6 * 60 * 60 * 1000) continue;

    // スロット時刻以降に投稿があればスキップ
    const postsAfter = getPostsAfter(slotTime);
    if (postsAfter.length > 0) {
      console.log(`  ✅ [${slot.label}] 投稿済み確認 → スキップ`);
      continue;
    }

    // 取りこぼし検出 → 補完投稿
    console.log(`\n[${jst()}] ⚡ 取りこぼし検出: ${slot.label} → 補完投稿開始`);
    try {
      if (slot.extra) await slot.extra();
      const items = await slot.fetchFn(1);
      await postItems(items, slot.type, slot.label);
    } catch (e: any) {
      console.error(`  ❌ 補完投稿失敗 [${slot.label}]: ${e.message}`);
    }

    // 補完は1スロットのみ（複数取りこぼしの場合は次の起動で対応）
    break;
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

  // ── 常時監視ループを起動（5分後に初回実行）───────────────────────────────
  sleep(5 * 60 * 1000).then(() => monitoringLoop());

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
  }, { timezone: 'Asia/Tokyo' });

  // ── 投稿スケジュール ─────────────────────────────────────────────────────
  // 設計方針（有益6：共感2：宣伝2）:
  //   宣伝投稿（アフィリリンク付き）: 09:00 / 12:00 / 18:00 / 20:00(芸能人) / 21:00 / 23:00 → 6本
  //   インプ狙い投稿（リンクなし）  : 10:30 / 17:00 → 2本
  //   合計: 8本/日、宣伝比率 = 6/8 = 75% → 段階的に比率改善

  // 09:00 JST — 素人 1件
  cron.schedule('0 9 * * *', async () => {
    const items = await getAmateurItems(1);
    await postItems(items, 'amateur', '09:00 素人');
  }, { timezone: 'Asia/Tokyo' });

  // 10:30 JST — インプ狙い投稿①（比較/あるある/Q&A 等）
  cron.schedule('30 10 * * *', async () => {
    await postImpressionSlot('10:30 インプ');
  }, { timezone: 'Asia/Tokyo' });

  // 12:00 JST — 高評価 1件
  cron.schedule('0 12 * * *', async () => {
    const items = await getHighRatedItems(1);
    await postItems(items, 'buzz', '12:00 高評価');
  }, { timezone: 'Asia/Tokyo' });

  // 17:00 JST — インプ狙い投稿②（ランキング/注意喚起/共感 等）
  cron.schedule('0 17 * * *', async () => {
    await postImpressionSlot('17:00 インプ');
  }, { timezone: 'Asia/Tokyo' });

  // 18:00 JST — バズ 1件 + 指標更新
  cron.schedule('0 18 * * *', async () => {
    await refreshRecentMetrics();
    const items = await getBuzzItems(1);
    await postItems(items, 'buzz', '18:00 バズ');
  }, { timezone: 'Asia/Tokyo' });

  // 21:00 JST — ランダム 1件
  cron.schedule('0 21 * * *', async () => {
    const items = await getRandomItems(1);
    await postItems(items, 'random', '21:00 ランダム');
  }, { timezone: 'Asia/Tokyo' });

  // 23:00 JST — セール品 1件
  cron.schedule('0 23 * * *', async () => {
    const items = await getSaleItems(1);
    await postItems(items, 'sale', '23:00 セール');
  }, { timezone: 'Asia/Tokyo' });

  // 月曜 08:00 JST — 週次パフォーマンスレポート（連絡チーム）
  cron.schedule('0 8 * * 1', async () => {
    const stats = getStats();
    const extInfo = getExternalPatternsInfo();
    const dynInfo = getDynamicTemplatesInfo();
    await contact.weeklyReport({
      投稿統計: stats,
      外部パターン: { 総数: extInfo.count, 最終更新: extInfo.lastRefreshedAt },
      動的テンプレート: { 総数: dynInfo.count, 進化回数: dynInfo.evolutionCount, 最終進化: dynInfo.lastEvolvedAt },
    });
  }, { timezone: 'Asia/Tokyo' });

  // 芸能人スロット — エンゲージメント最高時間帯（動的）
  const bestHour = getBestPostingHour();
  cron.schedule(`0 ${bestHour} * * *`, async () => {
    await postCelebritySlot(`${String(bestHour).padStart(2, '0')}:00 芸能人似`);
  }, { timezone: 'Asia/Tokyo' });

  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║    FANZA X Bot スケジューラー起動        ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  🎭 芸能人スロット: ${String(bestHour).padStart(2, '0')}:00 JST              ║`);
  console.log('║  📡 外部監視  常時ループ（3時間ごと）    ║');
  console.log('║  09:00 JST  素人系  1件                 ║');
  console.log('║  10:30 JST  💬インプ狙い①              ║');
  console.log('║  12:00 JST  高評価  1件（4.7点以上）    ║');
  console.log('║  17:00 JST  💬インプ狙い②              ║');
  console.log('║  18:00 JST  バズ    1件 + 指標更新      ║');
  console.log('║  21:00 JST  ランダム 1件               ║');
  console.log('║  23:00 JST  セール   1件               ║');
  console.log('║  計: 宣伝6本 + インプ2本 = 8本/日       ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
}
