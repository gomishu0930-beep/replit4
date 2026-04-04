/**
 * 自己修復ウォッチドッグ
 * ─────────────────────────────────────────────────────
 * 30分ごとに以下を自動実行:
 *  1. 投稿状態の監視 → 停止を検知
 *  2. 原因診断 (FANZA API / Twitter API / isPostingスタック)
 *  3. 自動回復 (フラグリセット → 緊急投稿)
 * すべてのイベントはGCSに永続化してダッシュボードに表示
 */

import { fetchItems, getSampleImages, getRandomItems } from './fanza.js';
import { uploadImages, postTweet, replyToTweet } from './twitter.js';
import { generateTweetText, generateEngagementReply } from './ai.js';
import { recordPost, getStats, getTopPatterns, getExternalTopPatterns } from './storage.js';
import { readJson, writeJson } from './cloudStore.js';

// ─── 状態管理 ────────────────────────────────────────────────────────────────

export type WatchdogStatus = 'healthy' | 'issue' | 'recovering' | 'failed';

export interface WatchdogEvent {
  at: string;
  level: 'info' | 'warn' | 'error' | 'recovery';
  detail: string;
}

interface WatchdogState {
  lastCheckAt: string | null;
  lastIssueAt: string | null;
  lastRecoveryAt: string | null;
  status: WatchdogStatus;
  issueCount: number;
  recoveryCount: number;
  consecutiveFailures: number;
  recentEvents: WatchdogEvent[];
}

const WATCHDOG_KEY = 'watchdog-state.json';
const MAX_EVENTS = 50;
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30分
// 「停止」とみなす最大無投稿時間（スロット間最大は9h: 23:00〜09:00）
const STALL_THRESHOLD_MS = 10 * 60 * 60 * 1000; // 10時間
// isPosting が stuck とみなす時間
const POSTING_STUCK_THRESHOLD_MS = 45 * 60 * 1000; // 45分

// 外部から isPosting を操作するための注入関数
let _getIsPosting: () => boolean = () => false;
let _getPostingStartedAt: () => number | null = () => null;
let _forceResetIsPosting: () => void = () => {};
let _triggerEmergencyPost: (() => Promise<void>) | null = null;

export function injectSchedulerHooks(hooks: {
  getIsPosting: () => boolean;
  getPostingStartedAt: () => number | null;
  forceResetIsPosting: () => void;
  triggerEmergencyPost: () => Promise<void>;
}) {
  _getIsPosting = hooks.getIsPosting;
  _getPostingStartedAt = hooks.getPostingStartedAt;
  _forceResetIsPosting = hooks.forceResetIsPosting;
  _triggerEmergencyPost = hooks.triggerEmergencyPost;
}

// インメモリキャッシュ
let _state: WatchdogState = {
  lastCheckAt: null,
  lastIssueAt: null,
  lastRecoveryAt: null,
  status: 'healthy',
  issueCount: 0,
  recoveryCount: 0,
  consecutiveFailures: 0,
  recentEvents: [],
};

// ─── 状態ヘルパー ─────────────────────────────────────────────────────────────

async function loadState(): Promise<void> {
  _state = await readJson<WatchdogState>(WATCHDOG_KEY, _state);
}

async function saveState(): Promise<void> {
  // 最新50件に絞る
  _state.recentEvents = _state.recentEvents.slice(-MAX_EVENTS);
  await writeJson(WATCHDOG_KEY, _state);
}

function addEvent(level: WatchdogEvent['level'], detail: string) {
  const ev: WatchdogEvent = { at: new Date().toISOString(), level, detail };
  _state.recentEvents.push(ev);
  const prefix = { info: 'ℹ', warn: '⚠', error: '❌', recovery: '✅' }[level];
  console.log(`  [WATCHDOG] ${prefix} ${detail}`);
}

export function getWatchdogState(): WatchdogState & { events: WatchdogEvent[] } {
  return { ..._state, events: [..._state.recentEvents].reverse() };
}

// ─── 診断モジュール ───────────────────────────────────────────────────────────

async function diagnoseFanzaApi(): Promise<{ ok: boolean; detail: string }> {
  try {
    const items = await fetchItems({ sort: 'rank', hits: '1' });
    return { ok: items.length > 0, detail: items.length > 0 ? 'FANZA API 正常' : 'FANZA API: 0件返却' };
  } catch (e: any) {
    return { ok: false, detail: `FANZA API エラー: ${e.message}` };
  }
}

async function diagnoseTwitterApi(): Promise<{ ok: boolean; detail: string }> {
  try {
    // Twitter APIのヘルスチェック：ツイート投稿ではなくAPIアクセスのみ確認
    const { TwitterApi } = await import('twitter-api-v2');
    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY ?? '',
      appSecret: process.env.TWITTER_API_SECRET ?? '',
      accessToken: process.env.TWITTER_ACCESS_TOKEN ?? '',
      accessSecret: process.env.TWITTER_ACCESS_SECRET ?? '',
    });
    await client.readOnly.v2.me();
    return { ok: true, detail: 'Twitter API 正常' };
  } catch (e: any) {
    const msg = e.message ?? String(e);
    // レートリミットは「一時的」なので別扱い
    if (msg.includes('429') || msg.includes('rate limit')) {
      return { ok: true, detail: `Twitter API レートリミット中（一時的）: ${msg}` };
    }
    return { ok: false, detail: `Twitter API エラー: ${msg}` };
  }
}

function diagnoseIsPostingStuck(): { stuck: boolean; detail: string } {
  if (!_getIsPosting()) return { stuck: false, detail: 'isPosting=false (正常)' };
  const startedAt = _getPostingStartedAt();
  if (startedAt === null) return { stuck: true, detail: 'isPosting=true だが開始時刻不明 → stuck疑い' };
  const elapsed = Date.now() - startedAt;
  if (elapsed > POSTING_STUCK_THRESHOLD_MS) {
    return { stuck: true, detail: `isPosting=true のまま ${Math.round(elapsed / 60000)}分経過 → stuck` };
  }
  return { stuck: false, detail: `isPosting=true (投稿処理中, ${Math.round(elapsed / 60000)}分)` };
}

// ─── 緊急投稿（ウォッチドッグ専用）─────────────────────────────────────────

async function emergencyPost(): Promise<void> {
  console.log('  [WATCHDOG] 🚨 緊急投稿開始...');
  const items = await getRandomItems(1);
  if (items.length === 0) throw new Error('緊急投稿: アイテム取得失敗');

  const item = items[0];
  const topPatterns = getTopPatterns(5);
  const externalPatterns = getExternalTopPatterns(5);
  const text = await generateTweetText(item, 'random', topPatterns, externalPatterns);
  const imageUrls = getSampleImages(item);
  const mediaIds = await uploadImages(imageUrls);
  const tweetId = await postTweet(text, mediaIds);

  await new Promise((r) => setTimeout(r, 45_000)); // 45秒待機
  const affiliateURL = item.affiliateURL ?? '';
  const replyId = await replyToTweet(tweetId, `🔗 作品ページはこちら👇\n${affiliateURL}`);

  await new Promise((r) => setTimeout(r, 30_000)); // 30秒待機
  const engText = generateEngagementReply('random');
  await replyToTweet(replyId, engText);

  recordPost({ tweetId, replyId, item, text, type: 'emergency' });
  console.log(`  [WATCHDOG] ✅ 緊急投稿完了: ${tweetId}`);
}

// ─── メイン診断・回復ループ ───────────────────────────────────────────────────

async function runWatchdogCycle(): Promise<void> {
  const now = new Date().toISOString();
  _state.lastCheckAt = now;

  // ① isPosting スタック検出
  const stuckDiag = diagnoseIsPostingStuck();
  if (stuckDiag.stuck) {
    addEvent('warn', stuckDiag.detail);
    _state.status = 'issue';
    _state.issueCount++;
    _state.lastIssueAt = now;

    addEvent('recovery', 'isPostingフラグを強制リセット');
    _forceResetIsPosting();
  } else {
    addEvent('info', stuckDiag.detail);
  }

  // ② 投稿停止（スタック）検出
  const stats = getStats();
  const lastPostedAt = stats.lastPostedAt ? new Date(stats.lastPostedAt).getTime() : 0;
  const silenceDuration = Date.now() - lastPostedAt;

  // 投稿停止しているかチェック
  const isStalled = lastPostedAt > 0 && silenceDuration > STALL_THRESHOLD_MS;
  if (!lastPostedAt) {
    addEvent('info', '投稿履歴なし（まだ初回投稿前）');
    await saveState();
    return;
  }

  if (!isStalled) {
    const hoursAgo = Math.round(silenceDuration / 3600000 * 10) / 10;
    addEvent('info', `最終投稿から ${hoursAgo}h — 正常範囲`);
    _state.status = 'healthy';
    _state.consecutiveFailures = 0;
    await saveState();
    return;
  }

  // ③ 停止確認 → 診断開始
  const hoursStalled = Math.round(silenceDuration / 3600000 * 10) / 10;
  addEvent('warn', `投稿停止を検知: ${hoursStalled}h 無投稿`);
  _state.status = 'issue';
  _state.issueCount++;
  _state.lastIssueAt = now;

  addEvent('info', '診断開始: FANZA API / Twitter API をテスト中...');

  const [fanzaDiag, twitterDiag] = await Promise.all([
    diagnoseFanzaApi(),
    diagnoseTwitterApi(),
  ]);

  addEvent(fanzaDiag.ok ? 'info' : 'error', fanzaDiag.detail);
  addEvent(twitterDiag.ok ? 'info' : 'error', twitterDiag.detail);

  if (!fanzaDiag.ok || !twitterDiag.ok) {
    addEvent('warn', 'API障害検知 → 回復を待機（次回チェックで再試行）');
    _state.status = 'failed';
    _state.consecutiveFailures++;
    await saveState();
    return;
  }

  // ④ 全API正常 → 緊急投稿で回復
  _state.status = 'recovering';
  addEvent('recovery', 'API正常確認 → 緊急投稿で回復を試みます');
  await saveState();

  try {
    // スケジューラーの緊急投稿フックを優先使用
    if (_triggerEmergencyPost && !_getIsPosting()) {
      await _triggerEmergencyPost();
    } else if (!_getIsPosting()) {
      await emergencyPost();
    } else {
      addEvent('warn', '投稿処理中のため緊急投稿をスキップ');
      await saveState();
      return;
    }

    _state.status = 'healthy';
    _state.consecutiveFailures = 0;
    _state.recoveryCount++;
    _state.lastRecoveryAt = new Date().toISOString();
    addEvent('recovery', `✅ 自動回復成功 (通算 ${_state.recoveryCount}回目)`);
  } catch (e: any) {
    _state.status = 'failed';
    _state.consecutiveFailures++;
    addEvent('error', `緊急投稿失敗: ${e.message} (連続失敗: ${_state.consecutiveFailures}回)`);
  }

  await saveState();
}

// ─── ウォッチドッグループ起動 ─────────────────────────────────────────────────

export async function startWatchdog(): Promise<void> {
  await loadState();
  console.log('  🐕 ウォッチドッグ起動 (30分ごとに自動診断)');

  // 即座に初回チェック
  try {
    await runWatchdogCycle();
  } catch (e: any) {
    console.error(`  [WATCHDOG] 初回チェックエラー: ${e.message}`);
  }

  // 以降は30分ごと
  setInterval(async () => {
    try {
      await runWatchdogCycle();
    } catch (e: any) {
      console.error(`  [WATCHDOG] サイクルエラー: ${e.message}`);
    }
  }, CHECK_INTERVAL_MS);
}
