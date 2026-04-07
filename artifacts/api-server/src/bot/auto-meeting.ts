/**
 * auto-meeting.ts — 自律AI会議エンジン
 *
 * GPT × Claude × Grok が自動的に会議を開き、決定事項を抽出・実行する。
 * ユーザーへは「手動でしかできないこと」だけを通知する。
 *
 * フロー（頭→手）:
 *   ─ 頭（情報収集＋会議）──────────────────────────────────────────
 *   1. Grokで今夜のXリアルタイムデータ取得 → アジェンダ自動生成
 *   2. 事前Webリサーチ（深掘り調査）
 *   3. o3×Claude×Grok 5ラウンドトリアローグ
 *   4. 決定事項抽出・分類
 *   ─ 手（実行）────────────────────────────────────────────────────
 *   a. ai担当 → 即時 executeDirective → strategy/template更新（策定サイクル）
 *   b. Grok指令 → ツイート本文抽出 → X投稿（投稿サイクル）
 *      user担当 → directive保存のみ → ユーザーへ通知
 */

import OpenAI from 'openai';
import {
  createMeetingSession,
  runTrialogue,
  runDeepResearch,
  extractDecisions,
  addDirective,
  saveDirectiveExecution,
  updateDirectiveStatus,
  getMeetingById,
} from './meeting.js';
import { executeDirective } from './directive-executor.js';
import { getStats, getDailyImpressionSnapshots, getLatestAlgoInsight, getLatestSnapshot, getPostsAfter } from './storage.js';
import { getStrategySummary } from './strategy.js';
import { contact } from './contact.js';
import { getGrokXBriefing } from './grok.js';
import { postTweet } from './twitter.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// A/Bテスト週判定
function getABTestWeek(): 'W1' | 'W2' | 'normal' {
  const nowJst = new Date(Date.now() + 9 * 3600000);
  const dateKey = nowJst.toISOString().slice(0, 10);
  if (dateKey >= '2026-04-07' && dateKey <= '2026-04-13') return 'W1';
  if (dateKey >= '2026-04-14' && dateKey <= '2026-04-20') return 'W2';
  return 'normal';
}

// 本日JST 0:00以降の投稿件数
function getTodayPostCount(): number {
  const nowJst = new Date(Date.now() + 9 * 3600000);
  const todayMidnightJst = new Date(
    Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate()) - 9 * 3600000,
  );
  return getPostsAfter(todayMidnightJst).length;
}

// ─── 自律会議結果の型 ─────────────────────────────────────────────────────────

export interface AutoMeetingResult {
  meetingId: string;
  title: string;
  runAt: string;
  topic: string;
  totalDecisions: number;
  autoExecuted: Array<{ text: string; result: string; success: boolean }>;
  manualItems: Array<{ text: string; category: string; priority: string; rationale: string }>;
  duration_ms: number;
}

// ─── アジェンダ自動生成 ───────────────────────────────────────────────────────

async function buildAutoAgenda(): Promise<string> {
  const stats = getStats();
  const strategyObj = getStrategySummary();
  const strategy = `インターバル${strategyObj.monitorIntervalHours}h / 最終評価:${strategyObj.lastEvaluatedAt ? new Date(strategyObj.lastEvaluatedAt).toLocaleDateString('ja-JP') : '未評価'}`;
  const snapshots = getDailyImpressionSnapshots(7);
  const latestInsight = getLatestAlgoInsight();
  const snapshot = getLatestSnapshot();

  const recentImpressions = snapshots.slice(-7).map(s => s.avgImpressions);
  const avgImp = recentImpressions.length > 0
    ? Math.round(recentImpressions.reduce((a, b) => a + b, 0) / recentImpressions.length)
    : 0;
  const trend = recentImpressions.length >= 2
    ? (recentImpressions[recentImpressions.length - 1] > recentImpressions[0] ? '上昇' : '下降')
    : '不明';

  const algoContext = latestInsight
    ? `\n\n【保存済みアルゴ解析（${new Date(latestInsight.generatedAt).toLocaleDateString('ja-JP')}）】\n${latestInsight.briefing?.slice(0, 400) ?? 'データなし'}`
    : '';

  // Grok 4.1 Fast でXリアルタイムデータを取得
  console.log('  🦅 [自律会議] Grok でXリアルタイムデータを取得中...');
  let grokContext = '';
  try {
    const briefing = await getGrokXBriefing();
    grokContext = `\n\n${briefing.slice(0, 800)}`;
    console.log('  ✅ [自律会議] Grok Xブリーフィング取得完了');
  } catch (e: any) {
    console.warn('  ⚠ [自律会議] Grok取得失敗:', e.message);
  }

  return `【FANZA Xボット自律運営会議】${new Date().toLocaleDateString('ja-JP')} 自動実行

## 現状データ
- フォロワー: ${snapshot?.followersCount ?? '不明'}人（シャドウバン回復中）
- 過去7日平均インプレッション: ${avgImp}（トレンド: ${trend}）
- 累計投稿数: ${stats.totalPosts ?? 0}件
- 現在の戦略: ${strategy}
${algoContext}
${grokContext}

## 議論してほしいこと
1. Grokが収集したXリアルタイムデータを踏まえ、シャドウバン回復の進捗評価と最優先アクション
2. コンテンツ・投稿タイミング・テンプレートで今すぐ改善できること（具体的に）
3. AIが自動実行すべき改善アクション vs ユーザーが手動対応すべき事項の明確な切り分け

結論として「AIが今週中に実行すること」と「ユーザーが確認・対応すること」を明確に合意してください。`;
}

// ─── 自律AI会議の実行 ─────────────────────────────────────────────────────────

export async function runAutonomousMeeting(customTopic?: string): Promise<AutoMeetingResult> {
  const startAt = Date.now();
  const runAt = new Date().toISOString();
  const topic = customTopic ?? await buildAutoAgenda();

  console.log('\n  🤝 [自律会議] 自動AI会議を開始...');

  // 1a. 事前Webリサーチ（GPT-4o web search）
  console.log('  🔎 [自律会議] 事前Webリサーチ実行中...');
  let researchId: string | undefined;
  try {
    const now = new Date();
    const weekStr = now >= new Date('2026-04-14') ? 'W2(05:00枠)' : 'W1(10:30枠)';
    const researchTopic = `2026年最新のX(Twitter)シャドウバン回復戦略・FANZA/成人向けアフィリエイトアカウントのアルゴリズム攻略法。${weekStr}投稿A/Bテスト中（フォロワー341人・日本語アカウント）。インプレッション改善と外部からの流入増加のための具体的手法を調査してください。`;
    const research = await runDeepResearch(researchTopic);
    researchId = research.id;
    console.log(`  ✅ [自律会議] Webリサーチ完了 (${research.result.length}文字取得)`);
  } catch (e: any) {
    console.warn('  ⚠ [自律会議] Webリサーチ失敗:', e.message);
  }

  // 1b. 会議セッション作成（リサーチIDを紐付け）
  const title = `【自律】${new Date().toLocaleDateString('ja-JP')} 週次戦略会議`;
  const session = await createMeetingSession(title, researchId);

  // 2. o3 × Claude × Grok トリアローグ実行（5ラウンド）
  console.log('  💬 [自律会議] o3/Claude/Grok 3者議論中（5ラウンド）...');
  try {
    await runTrialogue(session.id, topic);
  } catch (e: any) {
    console.error('  ❌ [自律会議] トリアローグ失敗:', e.message);
    return {
      meetingId: session.id, title, runAt, topic,
      totalDecisions: 0, autoExecuted: [], manualItems: [],
      duration_ms: Date.now() - startAt,
    };
  }

  // 3. 決定事項抽出
  console.log('  📋 [自律会議] 決定事項を抽出中...');
  let candidates: Awaited<ReturnType<typeof extractDecisions>> = [];
  try {
    candidates = await extractDecisions(session.id);
  } catch (e: any) {
    console.error('  ❌ [自律会議] 決定事項抽出失敗:', e.message);
    return {
      meetingId: session.id, title, runAt, topic,
      totalDecisions: 0, autoExecuted: [], manualItems: [],
      duration_ms: Date.now() - startAt,
    };
  }
  console.log(`  → ${candidates.length}件の決定事項を検出`);

  const autoExecuted: AutoMeetingResult['autoExecuted'] = [];
  const manualItems: AutoMeetingResult['manualItems'] = [];

  // 4. 決定事項を分類・処理
  for (const candidate of candidates) {
    const sourceLabel = `自律会議 ${new Date().toLocaleDateString('ja-JP')}`;

    if (candidate.assignee === 'ai') {
      // ── AIタスク: 即時実行 ──
      const directive = await addDirective(
        candidate.text, candidate.category, candidate.priority, sourceLabel, 'ai', 'x',
      );
      try {
        const execution = await executeDirective(directive);
        await saveDirectiveExecution(directive.id, execution);
        if (execution.success) {
          await updateDirectiveStatus(directive.id, 'completed');
          autoExecuted.push({ text: candidate.text.slice(0, 80), result: execution.summary, success: true });
          console.log(`  ✅ [自律会議] 自動実行: ${execution.summary}`);
        } else {
          autoExecuted.push({ text: candidate.text.slice(0, 80), result: execution.summary, success: false });
        }
      } catch (e: any) {
        autoExecuted.push({ text: candidate.text.slice(0, 80), result: e.message, success: false });
      }
    } else {
      // ── ユーザー/外部タスク: 保存して通知 ──
      await addDirective(
        candidate.text, candidate.category, candidate.priority, sourceLabel, 'user', 'x',
      );
      manualItems.push({
        text: candidate.text,
        category: candidate.category,
        priority: candidate.priority,
        rationale: candidate.rationale,
      });
      console.log(`  👤 [自律会議] 手動確認: ${candidate.text.slice(0, 60)}`);
    }
  }

  const duration_ms = Date.now() - startAt;

  // 5. ユーザーへ通知（手動対応が必要なものだけ）
  await notifyMeetingResult({ autoExecuted, manualItems, title, duration_ms });

  console.log(`  ✅ [自律会議] 完了: 自動実行${autoExecuted.length}件 / 手動確認${manualItems.length}件 (${Math.round(duration_ms / 1000)}秒)`);

  return {
    meetingId: session.id, title, runAt, topic,
    totalDecisions: candidates.length,
    autoExecuted, manualItems, duration_ms,
  };
}

// ─── 通知 ─────────────────────────────────────────────────────────────────────

async function notifyMeetingResult(params: {
  autoExecuted: AutoMeetingResult['autoExecuted'];
  manualItems: AutoMeetingResult['manualItems'];
  title: string;
  duration_ms: number;
}): Promise<void> {
  const { autoExecuted, manualItems, title, duration_ms } = params;

  const successCount = autoExecuted.filter(r => r.success).length;
  const lines: string[] = [
    `所要時間: ${Math.round(duration_ms / 1000)}秒`,
    '',
    `【AIが自動実行した内容】(${successCount}/${autoExecuted.length}件成功)`,
    ...autoExecuted.slice(0, 4).map(r =>
      `${r.success ? '✅' : '⚠️'} ${r.text.slice(0, 50)} → ${r.result.slice(0, 40)}`
    ),
  ];

  if (manualItems.length > 0) {
    lines.push('', `【あなたの確認が必要】(${manualItems.length}件)`);
    lines.push(...manualItems.slice(0, 5).map((m, i) =>
      `${i + 1}. [${m.priority}] ${m.text.slice(0, 60)}`
    ));
    lines.push('', '→ ダッシュボード「🏠ホーム」の「要確認タスク」をご確認ください。');
  } else {
    lines.push('', '✅ 手動対応なし。全て自動で処理しました。');
  }

  await contact.systemAlert(title, lines.join('\n'));
}

// ─── 頭→手サイクル: 会議→ツイート生成→投稿 ─────────────────────────────────────

export interface MeetingPostResult {
  meetingId: string;
  directive?: string;
  tweetText?: string;
  tweetId?: string;
  posted: boolean;
  reason?: string;
}

/** 今夜の最強投稿を決める会議トピックを自動生成 */
async function buildMeetingPostTopic(): Promise<string> {
  const snapshot = getLatestSnapshot();
  const snapshots = getDailyImpressionSnapshots(7);
  const avgImp = snapshots.length > 0
    ? Math.round(snapshots.reduce((a, b) => a + b.avgImpressions, 0) / snapshots.length)
    : 0;
  const todayCount = getTodayPostCount();
  const abWeek = getABTestWeek();

  let grokContext = '';
  try {
    grokContext = (await getGrokXBriefing()).slice(0, 500);
  } catch { /* Grok取得失敗時は省略 */ }

  return `【AI自律投稿会議】3AIが今夜の最強ツイートを1本決定・即投稿する

## 現状
- アカウント: @suguhalove0419（フォロワー${snapshot?.followersCount ?? '不明'}人・シャドウバン回復中）
- 今日の投稿数: ${todayCount}件 / A/Bテスト: ${abWeek}
- 7日間平均インプ: ${avgImp}

## Xリアルタイム情報（Grok取得済み）
${grokContext || '（取得中）'}

## ミッション：今夜のベストツイートを1本決定
- ジャンル・形式・スタイルは完全自由（FANZAアフィリ・インプ型・時事・エンタメ・挑発フック など）
- o3とClaudeが「今夜最強の投稿」を1本ずつ具体的に提案する（ツイート本文まで書くこと）
- GrokがXデータを根拠に勝者を裁定し、その本文を🎯指令に必ず含めること

## 最終ラウンド必須フォーマット
📊 最終総合スコア: [o3合計: X/50] [Claude合計: Y/50]
🏆 最終裁定: [o3|Claude]案採用 — 理由1行
🎯 自律実行指令: 以下のツイート本文をそのまま投稿せよ→「[140文字以内の実際のツイート本文]」
AIがこの本文をそのままXに投稿します。`;
}

/** Grok指令からツイート本文を抽出（「」直接抽出 → 失敗時はOpenAI変換） */
async function extractTweetFromDirective(directive: string): Promise<string> {
  // パターン1: 「本文」形式を直接抽出
  const quoteMatch = directive.match(/[「『"](.{10,140})[」』"]/);
  if (quoteMatch) return quoteMatch[1].trim();

  // パターン2: →「本文」or →本文 形式
  const arrowMatch = directive.match(/→\s*[「]?(.{10,140})[」]?/);
  if (arrowMatch) return arrowMatch[1].trim();

  // パターン3: OpenAIで指令を解釈してツイート本文を生成
  console.log('  🤖 [会議→投稿] 指令からOpenAIでツイート本文を生成中...');
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `以下はX(Twitter)ボット運営のAI会議でGrokが出した自律実行指令です。この指令に従い、実際にXに投稿するツイート本文（日本語・140文字以内・🔞表現可）を1つだけ出力してください。ツイート本文だけを出力し、説明・注釈は一切書かないこと。\n\n指令: ${directive}`,
    }],
    max_tokens: 200,
  });
  return completion.choices[0]?.message?.content?.trim() ?? '';
}

/**
 * 会議→生成→投稿 フルサイクル（頭→手）
 *
 * - W1/W2期間かつ本日投稿済み → 会議（情報収集）のみ、投稿スキップ
 * - W3以降 or 本日未投稿      → 会議 + ツイート生成 + 即時投稿
 * - bypassDailyLimit=true     → 投稿制限を無視して必ず投稿
 */
export async function runMeetingAndPost(options?: { bypassDailyLimit?: boolean }): Promise<MeetingPostResult> {
  const jst = () => new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  console.log(`\n[${jst()}] 🎙 [会議→投稿] 自律フルサイクル開始`);

  // ─ 頭: 会議（情報収集→議論→決定） ───────────────────────────
  const topic = await buildMeetingPostTopic();
  let result: AutoMeetingResult;
  try {
    result = await runAutonomousMeeting(topic);
  } catch (e: any) {
    console.error(`[${jst()}] ❌ [会議→投稿] 会議エラー: ${e.message}`);
    return { meetingId: '', posted: false, reason: `会議エラー: ${e.message}` };
  }

  // ─ 指令抽出 ──────────────────────────────────────────────────
  const session = getMeetingById(result.meetingId);
  const grokMessages = (session?.messages ?? []).filter(m => m.speaker === 'grok');
  const lastGrok = grokMessages[grokMessages.length - 1];
  const directiveMatch = lastGrok?.content.match(/🎯\s*自律実行指令[：:]\s*(.+?)(?:\n|$)/s);

  if (!directiveMatch) {
    console.warn(`[${jst()}] ⚠ [会議→投稿] Grok指令が見つかりません。会議の情報収集のみ完了`);
    return { meetingId: result.meetingId, posted: false, reason: 'Grok指令なし（情報収集のみ完了）' };
  }
  const directiveText = directiveMatch[1].trim();
  console.log(`\n[${jst()}] 🎯 [会議→投稿] 指令: ${directiveText.slice(0, 120)}`);

  // ─ 手: 投稿可否チェック ───────────────────────────────────────
  const abWeek = getABTestWeek();
  const todayCount = getTodayPostCount();
  if (!options?.bypassDailyLimit && abWeek !== 'normal' && todayCount >= 1) {
    console.log(`[${jst()}] ℹ [会議→投稿] ${abWeek}期間・本日${todayCount}件投稿済み → 投稿スキップ（情報収集のみ完了）`);
    await contact.systemAlert(
      '🎙 AI会議完了（情報収集モード）',
      `${abWeek}期間中のため投稿はスキップしました。\n\nGrok指令: ${directiveText.slice(0, 200)}\n\n次回W3以降またはbypassモードで投稿されます。`,
    );
    return { meetingId: result.meetingId, directive: directiveText, posted: false, reason: `${abWeek}制限・本日${todayCount}件投稿済み` };
  }

  // ─ 手: ツイート生成 ──────────────────────────────────────────
  let tweetText: string;
  try {
    tweetText = await extractTweetFromDirective(directiveText);
  } catch (e: any) {
    console.error(`[${jst()}] ❌ [会議→投稿] ツイート生成エラー: ${e.message}`);
    return { meetingId: result.meetingId, directive: directiveText, posted: false, reason: `生成エラー: ${e.message}` };
  }

  if (!tweetText || tweetText.length < 5) {
    console.error(`[${jst()}] ❌ [会議→投稿] ツイート本文が空`);
    return { meetingId: result.meetingId, directive: directiveText, posted: false, reason: 'ツイート本文抽出失敗' };
  }

  // ─ 手: X投稿 ─────────────────────────────────────────────────
  console.log(`\n[${jst()}] 🚀 [会議→投稿] ツイート投稿: "${tweetText.slice(0, 60)}..."`);
  try {
    const tweetId = await postTweet(tweetText, []);
    console.log(`\n[${jst()}] 🏁 [会議→投稿] 投稿完了！ tweetId: ${tweetId}`);
    await contact.systemAlert(
      '🏁 AI会議→投稿 完了',
      `Grok裁定に基づき自律投稿しました。\n\n📝 投稿内容:\n${tweetText}\n\n🔗 tweetId: ${tweetId}`,
    );
    return { meetingId: result.meetingId, directive: directiveText, tweetText, tweetId, posted: true };
  } catch (e: any) {
    console.error(`[${jst()}] ❌ [会議→投稿] 投稿エラー: ${e.message}`);
    return { meetingId: result.meetingId, directive: directiveText, tweetText, posted: false, reason: `投稿エラー: ${e.message}` };
  }
}
