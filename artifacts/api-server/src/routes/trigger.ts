import { Router } from 'express';
import OpenAI from 'openai';
import { getHighRatedItems, getSaleItems, getBuzzItems, getRandomItems, getAmateurItems, getKeywordItems, getItemById, getSampleImages } from '../bot/fanza.js';
import { uploadImages, postTweet, replyToTweet } from '../bot/twitter.js';
import { generateTweetText, generateEngagementReply } from '../bot/ai.js';
import { recordPost, getTopPatterns, getExternalTopPatterns, getPostsAfter } from '../bot/storage.js';
import { getIsPosting as getSchedulerIsPosting, postCelebritySlotNow } from '../bot/scheduler.js';
import { runAutonomousMeeting } from '../bot/auto-meeting.js';
import { getMeetingById } from '../bot/meeting.js';

import { refreshRecentMetrics, refreshExternalPatterns } from '../bot/analytics.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

// ─── 会議→投稿：AI3者会議の裁定に基づき実際にツイートを投稿 ───────────────────
const MEETING_POST_TOPIC = `【AI自律決定投稿テスト】インプレッション最大化投稿を3AIが決定・即実行する会議

## 現状
- @suguhalove0419 はシャドウバン回復中（フォロワー341人）
- A/Bテスト W1期間中（投稿内容・スタイルを実験中）

## 投稿内容は完全自由
ジャンル・形式・スタイルに一切制限なし。
FANZAアフィリ・インプ型・共感型・時事ネタ・挑発フック・Pollなど何でもOK。
**具体的なツイート本文（日本語140文字以内）を生成して決定すること。**

## 議論してほしいこと
1. 今夜のXリアルタイムトレンドでシャドウバン中でも最大インプが狙えるジャンルは？（Grokがリアルタイム判断）
2. o3とClaudeが「今夜最強の投稿」を1本ずつ具体的に提案（ツイート本文まで作ること）
3. GrokがXデータを根拠に勝者を決定し、そのツイート本文を🎯指令に含めること

## 裁定フォーマット（必須）
📊 最終総合スコア: [o3合計: X/50] [Claude合計: Y/50]
🏆 最終裁定: [o3|Claude]案採用 — 理由1行
🎯 自律実行指令: 以下のツイート本文をそのまま投稿せよ→「[ここに実際のツイート本文140文字以内]」
AIがこの本文をそのままXに投稿します。`;

async function runMeetingAndPostDirective(): Promise<void> {
  const jst = () => new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  console.log(`\n[${jst()}] 🎙 [会議投稿] 自律会議を開始します`);

  let meetingId: string;
  try {
    const result = await runAutonomousMeeting(MEETING_POST_TOPIC);
    meetingId = result.meetingId;
    console.log(`\n[${jst()}] ✅ [会議投稿] 会議完了 (ID: ${meetingId})`);
  } catch (e: any) {
    console.error(`[${jst()}] ❌ [会議投稿] 会議エラー: ${e.message}`);
    return;
  }

  // 会議セッションから最終ラウンドのGrokメッセージを取得
  const session = getMeetingById(meetingId);
  if (!session) {
    console.error(`[${jst()}] ❌ [会議投稿] セッションが見つかりません: ${meetingId}`);
    return;
  }

  const grokMessages = session.messages.filter((m) => m.speaker === 'grok');
  const lastGrokMsg = grokMessages[grokMessages.length - 1];
  if (!lastGrokMsg) {
    console.error(`[${jst()}] ❌ [会議投稿] Grokメッセージが見つかりません`);
    return;
  }

  console.log(`\n[${jst()}] 📋 [会議投稿] Grok最終裁定:\n${lastGrokMsg.content.slice(0, 600)}`);

  // 🎯 自律実行指令からツイート本文を抽出
  const directiveMatch = lastGrokMsg.content.match(/🎯\s*自律実行指令[：:]\s*(.+?)(?:\n|$)/s);
  if (!directiveMatch) {
    console.error(`[${jst()}] ❌ [会議投稿] 指令が見つかりません`);
    return;
  }
  const directiveText = directiveMatch[1].trim();
  console.log(`\n[${jst()}] 🎯 [会議投稿] 指令: ${directiveText}`);

  // 指令から「」内のツイート本文を直接抽出、なければOpenAIで変換
  let tweetText: string;
  const quoteMatch = directiveText.match(/[「『""](.{10,140})[」』""]/) ||
                     directiveText.match(/→\s*[「『""]?(.{10,140})[」』""]?/);
  if (quoteMatch) {
    tweetText = quoteMatch[1].trim();
    console.log(`[${jst()}] ✅ [会議投稿] 指令から本文を直接抽出: ${tweetText.slice(0, 60)}...`);
  } else {
    console.log(`[${jst()}] 🤖 [会議投稿] OpenAIで指令をツイート本文に変換中...`);
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: `以下はXボット運営AI会議でGrokが出した自律実行指令です。この指令に従い、実際にXに投稿するツイート本文（日本語、140文字以内、🔞表現可）を1つだけ出力してください。ツイート本文だけを出力し、それ以外は何も書かないこと。\n\n指令: ${directiveText}`,
        },
      ],
      max_tokens: 200,
    });
    tweetText = completion.choices[0]?.message?.content?.trim() ?? '';
    console.log(`[${jst()}] ✅ [会議投稿] 生成ツイート: ${tweetText}`);
  }

  if (!tweetText || tweetText.length < 5) {
    console.error(`[${jst()}] ❌ [会議投稿] ツイート本文が空です`);
    return;
  }

  // ツイート投稿
  console.log(`\n[${jst()}] 🚀 [会議投稿] ツイート投稿実行: "${tweetText.slice(0, 60)}..."`);
  try {
    const tweetId = await postTweet(tweetText, []);
    console.log(`\n[${jst()}] 🏁 [会議投稿] 投稿完了！ tweetId: ${tweetId}`);
    console.log(`[${jst()}] 📝 [会議投稿] 投稿内容:\n${tweetText}`);
  } catch (e: any) {
    console.error(`[${jst()}] ❌ [会議投稿] ツイート投稿エラー: ${e.message}`);
  }
}

// 会議→裁定投稿トリガー（バックグラウンド実行・即202を返す）
router.post('/trigger/meeting-post', auth, (_req, res) => {
  res.status(202).json({
    ok: true,
    message: '✅ AI3者会議を開始しました。会議完了後（約15分）にGrokの裁定に基づいて自動投稿されます。ログで進捗を確認できます。',
  });
  // バックグラウンドで実行（レスポンス返却後）
  runMeetingAndPostDirective().catch((e: any) =>
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

export default router;
