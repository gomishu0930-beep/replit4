/**
 * auto-meeting.ts — 自律AI会議エンジン（週次会議 / 投稿会議）
 *
 * ─ 週次会議（runAutonomousMeeting）──────────────────────────────────────────
 *   Phase 1: 先週の投稿検証（実績・IMP・いいね・RT）
 *   Phase 2: 現在のXの状況（Grokがリアルタイム報告）
 *   Phase 3: 施策の話し合い（o3×Claude×Grokで議論）
 *   Phase 4: 施策の決定（AI自動実行 / ユーザー確認）
 *
 * ─ 投稿会議（runMeetingAndPost）────────────────────────────────────────────
 *   Phase 1: 投稿の検証（直近の投稿パフォーマンスレビュー）
 *   Phase 2: Xで伸びているポストの検証（Grokがリアルタイム調査）
 *   Phase 3: 生成文の確定（o3×Claude→Grok裁定→ツイート本文決定）
 *   Phase 4: 投稿（X即時投稿）
 *
 * スケジューラーからの通常投稿（W1/W2/通常週）も投稿会議を経由する。
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
import { getStats, getDailyImpressionSnapshots, getLatestAlgoInsight, getLatestSnapshot, getPostsAfter, recordPost, resetBotData } from './storage.js';
import { getStrategySummary } from './strategy.js';
import { contact, sendMeetingFullLog } from './contact.js';
import { getGrokXBriefing } from './grok.js';
import { postTweet, uploadImages } from './twitter.js';
import { generateImage, buildImagePrompt, isNanobananaEnabled } from './imageGen.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── A/Bテスト週判定 ──────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
//  週次会議（runAutonomousMeeting）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 週次会議アジェンダ自動生成
 * Phase 1: 先週の投稿検証 → Phase 2: Xの状況 → Phase 3: 施策議論 → Phase 4: 施策決定
 */
async function buildWeeklyAgenda(): Promise<string> {
  const snapshot   = getLatestSnapshot();
  const snapshots  = getDailyImpressionSnapshots(7);
  const stats      = getStats();
  const strategyObj = getStrategySummary();
  const latestInsight = getLatestAlgoInsight();
  const abWeek = getABTestWeek();

  // ── Phase 1: 先週の投稿一覧 ──────────────────────────────────────────────
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600000);
  const lastWeekPosts = getPostsAfter(weekAgo);
  const postSummary = lastWeekPosts.length > 0
    ? lastWeekPosts.slice().reverse().map(p => {
        const m = p.metrics;
        const imp   = m?.impression_count ?? '未計測';
        const like  = m?.like_count ?? 0;
        const rt    = m?.retweet_count ?? 0;
        const bm    = m?.bookmark_count ?? 0;
        const date  = new Date(p.postedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
        return `  - [${p.type}] ${date} | インプ:${imp} | ❤${like} RT:${rt} 🔖${bm} | ${p.text?.slice(0, 60) ?? ''}`;
      }).join('\n')
    : '  先週の投稿なし';

  const avgImp = snapshots.length > 0
    ? Math.round(snapshots.reduce((a, b) => a + b.avgImpressions, 0) / snapshots.length)
    : 0;
  const trend = snapshots.length >= 2
    ? (snapshots[snapshots.length - 1].avgImpressions > snapshots[0].avgImpressions ? '↑上昇' : '↓下降')
    : '不明';

  const strategyStr = `監視間隔${strategyObj.monitorIntervalHours}h / 仮説${(strategyObj.hypotheses ?? []).length}件`;

  // ── Phase 2: Xリアルタイム情報（Grokが取得）──────────────────────────────
  console.log('  🦅 [週次会議] GrokでXリアルタイムデータ取得中...');
  let grokContext = '';
  try {
    grokContext = (await getGrokXBriefing()).slice(0, 1000);
    console.log('  ✅ [週次会議] Grokブリーフィング取得完了');
  } catch (e: any) {
    console.warn('  ⚠ [週次会議] Grok取得失敗:', e.message);
    grokContext = '（Grokリアルタイムデータ取得失敗 — 会議中に補足してください）';
  }

  const algoCtx = latestInsight
    ? `\n### アルゴ解析（${new Date(latestInsight.generatedAt).toLocaleDateString('ja-JP')}）\n${latestInsight.briefing?.slice(0, 400) ?? ''}`
    : '';

  return `【FANZA Xボット 週次戦略会議】${new Date().toLocaleDateString('ja-JP')} 自動開催

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Phase 1: 先週の投稿検証（まず全員でレビューすること）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### アカウント概況
- @gomi_shu_god / フォロワー${snapshot?.followersCount ?? '不明'}人
- A/Bテスト: ${abWeek}（W1=10:30枠 / W2=05:00枠 / W3以降=投稿会議3スロット）
- 先週の投稿数: ${lastWeekPosts.length}件 / 7日間平均インプ: ${avgImp}（${trend}）
- 累計投稿数: ${stats.totalPosts}件 / 累計いいね: ${stats.totalLikes}件
- 戦略: ${strategyStr}

### 先週の投稿一覧（実績つき）
${postSummary}
${algoCtx}

**全員がまずPhase 1を分析し、以下を明確にすること:**
1. 最もインプが高かった投稿 — タイプ・時間帯・テキストパターンの共通点は？
2. 最もインプが低かった投稿 — 失敗要因は何か？
3. 先週の施策決定事項は実施されたか？未実施のものはなぜか？

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Phase 2: 現在のXの状況（Grokが以下をリアルタイムで報告）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${grokContext}

**Grokへの指示（Phase 2担当）:**
- 今週のXトレンド・バズりジャンル・時事ネタを具体的に列挙
- 成人向け・アフィリエイト系アカウントのシャドウバン状況と回復事例を報告
- 先週と比較してXアルゴリズムに変化はあったか？

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Phase 3: 施策の話し合い（Phase 1・2を踏まえて議論）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

以下を具体的に議論すること:
1. **シャドウバン回復評価**: 先週のインプトレンドからSB回復の進捗をどう評価するか？
2. **コンテンツ改善**: 今週変えるべきテンプレート・投稿スタイル・フックは何か？
3. **タイミング最適化**: A/Bテスト（W1 10:30 vs W2 05:00）の中間評価と今週の対応
4. **G0達成戦略**: 4/13の「平均IMP≥15」達成に向けて残り期間で何をすべきか？

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Phase 4: 施策の決定（最終ラウンドで必ず合意すること）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

最終ラウンドでは以下の形式で施策を決定すること:

【AI実行】AIが今週中に自動実行するアクション（コード変更・テンプレート更新など）
→ 📌 決定候補: [具体的なアクション]（assignee: ai）

【ユーザー確認】手動対応が必要な事項
→ 📌 決定候補: [具体的なアクション]（assignee: user）

【今週の数値目標】G0達成に向けた具体的KPI
→ 今週の目標インプ: XXX / 目標いいね: XXX`;
}

// ─── 自律AI週次会議の実行 ─────────────────────────────────────────────────────

export async function runAutonomousMeeting(customTopic?: string): Promise<AutoMeetingResult> {
  const startAt = Date.now();
  const runAt = new Date().toISOString();
  const topic = customTopic ?? await buildWeeklyAgenda();

  console.log('\n  🤝 [週次会議] 自動AI会議を開始...');

  // 1a. 事前Webリサーチ（GPT-4o web search）
  console.log('  🔎 [週次会議] 事前Webリサーチ実行中...');
  let researchId: string | undefined;
  try {
    const weekDef = getABTestWeek();
    const weekStr = weekDef === 'W2' ? 'W2(05:00枠)' : weekDef === 'W1' ? 'W1(20:00プライムタイム枠)' : '通常週（動的18-22時枠）';
    const researchTopic = `2026年最新のX(Twitter) FANZA/成人向けアフィリエイトアカウントのプライムタイム投稿戦略。${weekStr}A/Bテスト中（日本語アカウント@gomi_shu_god・新規アカウント・シャドウバンなし）。凍結リスク最小化・最適投稿本数・プライムタイム時間帯選定・インプレッション最大化の具体的手法を調査してください。`;
    const research = await runDeepResearch(researchTopic);
    researchId = research.id;
    console.log(`  ✅ [週次会議] Webリサーチ完了 (${research.result.length}文字取得)`);
  } catch (e: any) {
    console.warn('  ⚠ [週次会議] Webリサーチ失敗:', e.message);
  }

  // 1b. 会議セッション作成
  const title = `【週次戦略会議】${new Date().toLocaleDateString('ja-JP')}`;
  const session = await createMeetingSession(title, researchId);

  // 2. o3 × Claude × Grok トリアローグ（5ラウンド）
  console.log('  💬 [週次会議] Phase 3-4: 3者議論中（5ラウンド）...');
  try {
    await runTrialogue(session.id, topic, 5);
  } catch (e: any) {
    console.error('  ❌ [週次会議] トリアローグ失敗:', e.message);
    return {
      meetingId: session.id, title, runAt, topic,
      totalDecisions: 0, autoExecuted: [], manualItems: [],
      duration_ms: Date.now() - startAt,
    };
  }

  // 3. 決定事項抽出
  console.log('  📋 [週次会議] Phase 4: 施策決定事項を抽出中...');
  let candidates: Awaited<ReturnType<typeof extractDecisions>> = [];
  try {
    candidates = await extractDecisions(session.id);
  } catch (e: any) {
    console.error('  ❌ [週次会議] 決定事項抽出失敗:', e.message);
    return {
      meetingId: session.id, title, runAt, topic,
      totalDecisions: 0, autoExecuted: [], manualItems: [],
      duration_ms: Date.now() - startAt,
    };
  }
  console.log(`  → ${candidates.length}件の施策決定事項を検出`);

  const autoExecuted: AutoMeetingResult['autoExecuted'] = [];
  const manualItems: AutoMeetingResult['manualItems'] = [];

  // 4. 決定事項を分類・処理
  for (const candidate of candidates) {
    const sourceLabel = `週次会議 ${new Date().toLocaleDateString('ja-JP')}`;

    if (candidate.assignee === 'ai') {
      const directive = await addDirective(
        candidate.text, candidate.category, candidate.priority, sourceLabel, 'ai', 'x',
      );
      try {
        const execution = await executeDirective(directive);
        await saveDirectiveExecution(directive.id, execution);
        if (execution.success) {
          await updateDirectiveStatus(directive.id, 'completed');
          autoExecuted.push({ text: candidate.text.slice(0, 80), result: execution.summary, success: true });
          console.log(`  ✅ [週次会議] 自動実行: ${execution.summary}`);
        } else {
          autoExecuted.push({ text: candidate.text.slice(0, 80), result: execution.summary, success: false });
        }
      } catch (e: any) {
        autoExecuted.push({ text: candidate.text.slice(0, 80), result: e.message, success: false });
      }
    } else {
      await addDirective(
        candidate.text, candidate.category, candidate.priority, sourceLabel, 'user', 'x',
      );
      manualItems.push({
        text: candidate.text,
        category: candidate.category,
        priority: candidate.priority,
        rationale: candidate.rationale,
      });
      console.log(`  👤 [週次会議] 手動確認: ${candidate.text.slice(0, 60)}`);
    }
  }

  const duration_ms = Date.now() - startAt;
  await notifyWeeklyMeetingResult({ autoExecuted, manualItems, title, duration_ms });

  // 会議フルログをメール送信
  try {
    const fullSession = getMeetingById(session.id);
    if (fullSession) {
      const decisionTexts = candidates.map(c => `[${c.assignee}/${c.priority}] ${c.text}`);
      const summaryLines = [
        `自動実行: ${autoExecuted.filter(r => r.success).length}/${autoExecuted.length}件成功`,
        `手動確認: ${manualItems.length}件`,
        ...autoExecuted.slice(0, 3).map(r => `  ${r.success ? '✅' : '⚠️'} ${r.text.slice(0, 60)}`),
      ];
      await sendMeetingFullLog({
        title,
        sessionId: session.id,
        messages: fullSession.messages,
        summary: summaryLines.join('\n'),
        decisions: decisionTexts,
        duration_ms,
      });
    }
  } catch (e: any) {
    console.warn('  ⚠ [週次会議] フルログメール送信失敗:', e.message);
  }

  console.log(`  ✅ [週次会議] 完了: 自動実行${autoExecuted.length}件 / 手動確認${manualItems.length}件 (${Math.round(duration_ms / 1000)}秒)`);

  return {
    meetingId: session.id, title, runAt, topic,
    totalDecisions: candidates.length,
    autoExecuted, manualItems, duration_ms,
  };
}

// ─── 通知（週次会議） ─────────────────────────────────────────────────────────

async function notifyWeeklyMeetingResult(params: {
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
    `【Phase 4 自動実行】(${successCount}/${autoExecuted.length}件成功)`,
    ...autoExecuted.slice(0, 4).map(r =>
      `${r.success ? '✅' : '⚠️'} ${r.text.slice(0, 50)} → ${r.result.slice(0, 40)}`
    ),
  ];

  if (manualItems.length > 0) {
    lines.push('', `【ユーザー確認が必要な施策】(${manualItems.length}件)`);
    lines.push(...manualItems.slice(0, 5).map((m, i) =>
      `${i + 1}. [${m.priority}] ${m.text.slice(0, 60)}`
    ));
    lines.push('', '→ ダッシュボード「🏠ホーム」の「要確認タスク」をご確認ください。');
  } else {
    lines.push('', '✅ 手動対応なし。全て自動で処理しました。');
  }

  await contact.systemAlert(title, lines.join('\n'));
}

// ─────────────────────────────────────────────────────────────────────────────
//  投稿会議（runMeetingAndPost）
// ─────────────────────────────────────────────────────────────────────────────

export interface MeetingPostResult {
  meetingId: string;
  directive?: string;
  tweetText?: string;
  tweetId?: string;
  posted: boolean;
  reason?: string;
}

/**
 * 投稿会議アジェンダ自動生成
 * Phase 1: 投稿の検証 → Phase 2: Xで伸びているポストの検証 → Phase 3: 生成文の確定
 */
async function buildPostMeetingTopic(): Promise<string> {
  const snapshot = getLatestSnapshot();
  const todayCount = getTodayPostCount();
  const abWeek = getABTestWeek();

  // ── Phase 1: 直近投稿の実績 ──────────────────────────────────────────────
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 3600000);
  const recentPosts = getPostsAfter(fourteenDaysAgo).slice(-10);
  const postReview = recentPosts.length > 0
    ? recentPosts.slice().reverse().map(p => {
        const m = p.metrics;
        const imp   = m?.impression_count ?? '未計測';
        const like  = m?.like_count ?? 0;
        const rt    = m?.retweet_count ?? 0;
        const bm    = m?.bookmark_count ?? 0;
        const date  = new Date(p.postedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        return `  - [${p.type}] ${date} | インプ:${imp} | ❤${like} RT:${rt} 🔖${bm} | ${p.text?.slice(0, 70) ?? ''}`;
      }).join('\n')
    : '  投稿履歴なし（初期状態）';

  // ── Phase 2: Grokがリアルタイムでバズり投稿を調査 ────────────────────────
  console.log('  🦅 [投稿会議] GrokでXバズり投稿を調査中...');
  let grokBuzz = '';
  try {
    grokBuzz = (await getGrokXBriefing()).slice(0, 1000);
    console.log('  ✅ [投稿会議] Grokバズり調査完了');
  } catch (e: any) {
    console.warn('  ⚠ [投稿会議] Grok調査失敗:', e.message);
    grokBuzz = '（Grokリアルタイムデータ取得失敗 — 会議中に現在のトレンドを分析してください）';
  }

  return `【FANZA Xボット 投稿会議】${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} 自動開催

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Phase 1: 投稿の検証（まず全員でレビューすること）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### アカウント概況
- @gomi_shu_god / フォロワー${snapshot?.followersCount ?? '不明'}人
- 今日の投稿数: ${todayCount}件 / A/Bテスト: ${abWeek}

### 直近10件の投稿実績
${postReview}

**全員がまずPhase 1を分析すること:**
1. 最もインプが高かった投稿 — タイプ・投稿時間帯・テキストパターンの共通点は？
2. 最もインプが低かった投稿 — 何が失敗要因か？
3. 今投稿するなら、どのタイプ・形式が最も効果的か（データ根拠で）？

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Phase 2: Xで伸びているポストの検証（Grokがリアルタイム調査済み）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${grokBuzz}

**Grokへの指示（Phase 2を必ず担当すること）:**
- 現在Xで最もインプを稼いでいる日本語ポストのジャンル・形式・フック文を具体的に3件以上列挙
- 成人向け・FANZA系アカウントが今伸びているコンテンツタイプを判定
- Phase 1の実績データと突き合わせて「今夜このアカウントが投稿すべき最強ジャンル」を1つ断言すること

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Phase 3: 生成文の確定（3ステップで進めること）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Step 3-1: 投稿方針の議論（まず全員で合意すること）
Phase 1・2の分析をもとに、**全員が以下を議論して方針を合意する:**
- 今夜はどのジャンル・形式が最もインプを稼げるか？（FANZAアフィリ / インプ型 / 共感型 / 時事ネタ / 挑発フック / Poll など）
- どんなフック文・冒頭パターンが今のXアルゴリズムに刺さるか？
- シャドウバン中のアカウントとして避けるべき表現・手法は何か？
- 文字数・絵文字・ハッシュタグの方針は？

**この議論を経て「今夜の投稿方針」を1-2行で全員が合意してから次のステップへ進むこと。**

### Step 3-2: 各自が生成（合意した方針に基づいてツイート本文を作成）
方針合意後、o3とClaudeはそれぞれ独立して「今夜最強の投稿」を1本生成する:
- 日本語140文字以内・🔞表現可
- Step 3-1で合意した方針を必ず反映すること
- 具体的なツイート本文を「」で囲んで提示すること

### Step 3-3: Grokが最終裁定（最終ラウンドで必須フォーマット）
o3案・Claude案をXデータで比較し、今夜最強の1本を選ぶ:
📊 最終スコア: [o3: X/30] [Claude: Y/30]
🏆 採用: [o3|Claude]案 — 理由1行（Xデータを根拠にすること）
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
  console.log('  🤖 [投稿会議] 指令からOpenAIでツイート本文を生成中...');
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
 * 投稿会議フルサイクル（Phase 1-4）
 *
 * Phase 1: 投稿の検証
 * Phase 2: Xで伸びているポストの検証（Grokリアルタイム）
 * Phase 3: 生成文の確定（3ラウンドトリアローグ）
 * Phase 4: X投稿
 *
 * - W1/W2期間かつ本日投稿済み → Phase 1-3まで実施・Phase 4（投稿）スキップ
 * - W3以降 or 本日未投稿      → Phase 1-4フル実行
 * - bypassDailyLimit=true     → 投稿制限を無視して必ずPhase 4まで実行
 */
export async function runMeetingAndPost(options?: { bypassDailyLimit?: boolean }): Promise<MeetingPostResult> {
  const jst = () => new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  console.log(`\n[${jst()}] 🎙 [投稿会議] Phase 1-4 フルサイクル開始`);

  // ── Phase 1-2: 投稿検証 + Xバズり調査 → トピック生成 ───────────────────
  const topic = await buildPostMeetingTopic();

  // 会議セッション作成（投稿会議はWebリサーチなし: Grokが会議中にリアルタイム調査）
  const title = `【投稿会議】${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`;
  const session = await createMeetingSession(title);

  // ── Phase 3: 3ラウンドトリアローグで生成文を確定 ────────────────────────
  console.log(`[${jst()}] 💬 [投稿会議] Phase 3: 3者議論（3ラウンド）...`);
  try {
    await runTrialogue(session.id, topic, 3);
  } catch (e: any) {
    console.error(`[${jst()}] ❌ [投稿会議] 議論エラー: ${e.message}`);
    return { meetingId: session.id, posted: false, reason: `議論エラー: ${e.message}` };
  }

  // ── Grok指令抽出（多段フォールバック）───────────────────────────────────
  const updatedSession = getMeetingById(session.id);
  const grokMessages = (updatedSession?.messages ?? []).filter(m => m.speaker === 'grok');
  const lastGrok = grokMessages[grokMessages.length - 1];

  let directiveText = '';

  // Pattern 1: 🎯自律実行指令： の完全一致
  const directiveMatch = lastGrok?.content.match(/🎯\s*自律実行指令[：:]\s*(.+?)(?:\n|$)/s);
  if (directiveMatch) {
    directiveText = directiveMatch[1].trim();
    console.log(`[${jst()}] 🎯 [投稿会議] Grok裁定（P1）: ${directiveText.slice(0, 80)}`);
  }

  // Pattern 2: 「」で囲まれたツイート本文を直接抽出
  if (!directiveText) {
    const quoteMatch = lastGrok?.content.match(/[「『"](.{15,140})[」』"]/);
    if (quoteMatch) {
      directiveText = quoteMatch[1].trim();
      console.log(`[${jst()}] 🎯 [投稿会議] Grok裁定（P2 引用抽出）: ${directiveText.slice(0, 80)}`);
    }
  }

  // Pattern 3: 採用/決定などのキーワード後のテキスト
  if (!directiveText) {
    const adoptMatch = lastGrok?.content.match(/(?:採用|決定|投稿|ツイート)[：:\s]*[「]?([🔞].{15,120})/);
    if (adoptMatch) {
      directiveText = adoptMatch[1].trim();
      console.log(`[${jst()}] 🎯 [投稿会議] Grok裁定（P3 採用後テキスト）: ${directiveText.slice(0, 80)}`);
    }
  }

  // Pattern 4: Grokの全文をOpenAIに渡してツイート本文を生成
  if (!directiveText && lastGrok?.content) {
    console.log(`[${jst()}] 🤖 [投稿会議] Grok指令未検出 → OpenAIでGrok応答からツイート本文を生成...`);
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `以下はX(Twitter)アフィリエイトボットのAI会議でGrokが出した最終応答です。この応答の中から「今日投稿すべきツイート本文」を特定し、そのツイート本文だけを140文字以内で出力してください。ツイート本文のみを出力し、説明・注釈は一切書かないこと。\n\nGrok応答:\n${lastGrok.content.slice(0, 2000)}`,
        }],
        max_tokens: 200,
        temperature: 0.3,
      });
      directiveText = completion.choices[0]?.message?.content?.trim() ?? '';
      if (directiveText) {
        console.log(`[${jst()}] 🎯 [投稿会議] Grok裁定（P4 OpenAI解釈）: ${directiveText.slice(0, 80)}`);
      }
    } catch (e: any) {
      console.warn(`[${jst()}] ⚠ [投稿会議] P4 OpenAI解釈エラー: ${e.message}`);
    }
  }

  if (!directiveText) {
    console.warn(`[${jst()}] ⚠ [投稿会議] 全パターンで指令抽出失敗`);
    return { meetingId: session.id, posted: false, reason: 'Grok指令抽出失敗（全4パターン）' };
  }
  console.log(`\n[${jst()}] 🎯 [投稿会議] Grok裁定: ${directiveText.slice(0, 120)}`);

  // ── Phase 4: 投稿可否チェック ────────────────────────────────────────────
  const abWeek = getABTestWeek();
  const todayCount = getTodayPostCount();
  if (!options?.bypassDailyLimit && abWeek !== 'normal' && todayCount >= 1) {
    console.log(`[${jst()}] ℹ [投稿会議] ${abWeek}・本日${todayCount}件投稿済み → Phase 4スキップ`);
    await contact.systemAlert(
      '🎙 投稿会議完了（Phase 4スキップ）',
      `${abWeek}制限中のため投稿はスキップ（Phase 1-3は完了）。\n\nGrok裁定: ${directiveText.slice(0, 200)}\n\n次回W3以降またはbypassモードで投稿されます。`,
    );
    return { meetingId: session.id, directive: directiveText, posted: false, reason: `${abWeek}制限・本日${todayCount}件投稿済み` };
  }

  // ── Phase 4: ツイート本文抽出 ────────────────────────────────────────────
  let tweetText: string;
  try {
    tweetText = await extractTweetFromDirective(directiveText);
  } catch (e: any) {
    console.error(`[${jst()}] ❌ [投稿会議] ツイート生成エラー: ${e.message}`);
    return { meetingId: session.id, directive: directiveText, posted: false, reason: `生成エラー: ${e.message}` };
  }

  if (!tweetText || tweetText.length < 5) {
    console.error(`[${jst()}] ❌ [投稿会議] ツイート本文が空`);
    return { meetingId: session.id, directive: directiveText, posted: false, reason: 'ツイート本文抽出失敗' };
  }

  // ── Phase 4: 画像生成（リンクなし投稿のみ）────────────────────────────────
  const hasUrl = /https?:\/\/\S+/.test(tweetText);
  let mediaIds: string[] = [];

  if (!hasUrl && isNanobananaEnabled()) {
    console.log(`\n[${jst()}] 🍌 [投稿会議] リンクなし投稿 → Nanobanana2で画像生成`);
    try {
      // 議論の中から商品名を抽出してプロンプトに活用
      const productTitle = directiveText.match(/[「『]([^」』]{5,40})[」』]/)?.[1];
      const imagePrompt = buildImagePrompt(tweetText, productTitle);
      console.log(`  プロンプト: ${imagePrompt.slice(0, 100)}`);

      const imageUrl = await generateImage(imagePrompt);
      const uploaded = await uploadImages([imageUrl]);
      mediaIds = uploaded;
      console.log(`  🖼 画像アップロード完了 mediaIds: ${mediaIds.join(', ')}`);
    } catch (e: any) {
      console.warn(`[${jst()}] ⚠ [投稿会議] 画像生成スキップ（エラー）: ${e.message}`);
      mediaIds = [];
    }
  } else if (!hasUrl && !isNanobananaEnabled()) {
    console.log(`[${jst()}] ℹ [投稿会議] リンクなし投稿・NANOBANANA_API_KEY未設定 → テキストのみ投稿`);
  }

  // ── Phase 4: X投稿 ───────────────────────────────────────────────────────
  const withImage = mediaIds.length > 0;
  console.log(`\n[${jst()}] 🚀 [投稿会議] Phase 4: X投稿${withImage ? '（画像付き）' : ''} → "${tweetText.slice(0, 60)}..."`);
  try {
    const tweetId = await postTweet(tweetText, mediaIds);
    recordPost({ tweetId, replyId: '', text: tweetText, type: 'meeting-post' });
    console.log(`\n[${jst()}] 🏁 [投稿会議] Phase 4完了！ tweetId: ${tweetId}`);
    await contact.systemAlert(
      `🏁 投稿会議→投稿完了${withImage ? '（画像付き）' : ''}`,
      `Phase 1-4フルサイクル完了。Grok裁定に基づき自律投稿しました。\n\n📝 投稿内容:\n${tweetText}\n${withImage ? '🖼 Nanobanana2生成画像添付\n' : ''}\n🔗 tweetId: ${tweetId}`,
    );
    return { meetingId: session.id, directive: directiveText, tweetText, tweetId, posted: true };
  } catch (e: any) {
    console.error(`[${jst()}] ❌ [投稿会議] 投稿エラー: ${e.message}`);
    return { meetingId: session.id, directive: directiveText, tweetText, posted: false, reason: `投稿エラー: ${e.message}` };
  }
}

// ─── 緊急会議（アカウント凍結後・新スタート時）────────────────────────────────

export interface EmergencyMeetingResult {
  meetingId: string;
  title: string;
  runAt: string;
  totalDecisions: number;
  autoExecuted: AutoMeetingResult['autoExecuted'];
  manualItems: AutoMeetingResult['manualItems'];
  resetData: { cleared: string[] };
  duration_ms: number;
}

export async function runEmergencyMeeting(): Promise<EmergencyMeetingResult> {
  const startAt = Date.now();
  const runAt = new Date().toISOString();
  const title = `【緊急戦略会議】アカウント凍結検証・新規スタート ${new Date().toLocaleDateString('ja-JP')}`;

  console.log('\n  🚨 [緊急会議] アカウント凍結対応・新規スタート会議を開始...');

  await contact.systemAlert('🚨 緊急会議開始', '凍結インシデント分析・新アカウント戦略決定会議を開始します。完了まで約10〜15分かかります。');

  // ── 事前リサーチ ──────────────────────────────────────────────────────────
  console.log('  🔎 [緊急会議] 事前Webリサーチ: 凍結回避・新アカウント成長戦略...');
  let researchId: string | undefined;
  try {
    const researchTopic = `2026年X(Twitter)アカウント凍結回避戦略。成人向けFANZAアフィリエイトアカウントが凍結された後、新アカウント(@gomi_shu_god)でゼロから再スタートする際のベストプラクティス。凍結を避けながらフォロワーを増やし、インプレッションを伸ばす具体的な方法を調査してください。`;
    const research = await runDeepResearch(researchTopic);
    researchId = research.id;
    console.log(`  ✅ [緊急会議] Webリサーチ完了 (${research.result.length}文字取得)`);
  } catch (e: any) {
    console.warn('  ⚠ [緊急会議] Webリサーチ失敗:', e.message);
  }

  // ── 会議セッション作成 ────────────────────────────────────────────────────
  const session = await createMeetingSession(title, researchId);

  // ── 緊急会議アジェンダ ────────────────────────────────────────────────────
  const stats = getStats();
  const topic = `# 緊急戦略会議: アカウント凍結インシデント検証・@gomi_shu_god 新規スタート戦略

あなたたちはFANZAアフィリエイトXボットの戦略チームです（o3=ストラテジスト, Claude=コピーライター, Grok=X専門家）。
今回は緊急事態が発生したため、通常の週次会議ではなく緊急インシデント対応会議を行います。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 【インシデント概要】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- **凍結アカウント**: @suguhalove0419（フォロワー341人）
- **凍結推定日時**: 2026年4月7日 21:30 JST頃
- **推定原因**:
  - シャドウバン中のアカウントで短時間に複数投稿が発生
  - bypass=trueフラグで日次制限を無視して2回目の投稿が実行された
  - 🔞アダルトコンテンツ × シャドウバン中 × 短時間重複投稿が重なった
- **新アカウント**: @gomi_shu_god（フォロワー数不明・新規）
- **ボット状態**: 緊急停止済み → 本会議で方針決定後に新規スタート

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Phase 1: インシデント分析（全員でレビュー）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

以下を分析・評価してください:
1. なぜこのような事態が発生したか？（技術的・運用的な根本原因）
2. bypass=true機能のリスクをどう評価するか？
3. シャドウバン中のアカウントに対して取るべき戦略は何だったか？
4. 過去の投稿実績（累計${stats.totalPosts}件、いいね${stats.totalLikes}件）から学べることは何か？

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Phase 2: Grok — X現状リサーチ（リアルタイム情報を提供）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Grokへの指示:
- 2026年現在のXにおけるアダルトアフィリエイトアカウントの凍結リスク要因を具体的に報告
- 新規アカウントが凍結リスクを最小化しながら成長するための実践的戦略を調査
- FANZAや成人コンテンツ系で凍結を避けつつ成功しているアカウントの特徴を分析

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Phase 3: 新規スタート戦略の策定（重要・具体的に議論）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@gomi_shu_god の新規スタート戦略を以下の観点で議論してください:

**【安全性】凍結リスク最小化**
- 1日の投稿上限・頻度・時間帯の最適解
- bypass機能は削除すべきか？代替の緊急対応手段は？
- センシティブコンテンツの扱い方（何をどこまで書いていいか）

**【成長戦略】ゼロからのフォロワー獲得**
- 新規アカウントが最初にやるべきことは何か？
- フォロワーゼロからインプレッションを伸ばすコンテンツ戦略
- FANZAアフィリエイト収益化に向けた投稿スタイルの見直し

**【コンテンツ戦略】旧アカウントの反省を活かした新テンプレート**
- 🔞フックの使い方を見直すか？どう変えるか？
- 日本語アカウントとして効果的な投稿フォーマット
- バズりやすい時間帯・曜日・テーマ

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Phase 4: 施策の決定（最終ラウンドで必ず合意）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

最終ラウンドでは以下の形式で施策を決定してください:

**【AI実行】ボットが即座に変更・実装するアクション**
→ 📌 決定候補: [具体的なアクション]（assignee: ai）

**【ユーザー確認】手動対応が必要な事項**
→ 📌 決定候補: [具体的なアクション]（assignee: user）

**【新規KPI設定】@gomi_shu_god の最初の目標**
→ 1ヶ月目標: フォロワーXX人 / 平均インプXX / 凍結ゼロ`;

  // ── o3 × Claude × Grok トリアローグ（5ラウンド）────────────────────────
  console.log('  💬 [緊急会議] 3者議論中（5ラウンド）...');
  try {
    await runTrialogue(session.id, topic, 5);
  } catch (e: any) {
    console.error('  ❌ [緊急会議] トリアローグ失敗:', e.message);
    return {
      meetingId: session.id, title, runAt,
      totalDecisions: 0, autoExecuted: [], manualItems: [],
      resetData: { cleared: [] }, duration_ms: Date.now() - startAt,
    };
  }

  // ── 決定事項抽出 ──────────────────────────────────────────────────────────
  console.log('  📋 [緊急会議] 施策決定事項を抽出中...');
  let candidates: Awaited<ReturnType<typeof extractDecisions>> = [];
  try {
    candidates = await extractDecisions(session.id);
  } catch (e: any) {
    console.error('  ❌ [緊急会議] 決定事項抽出失敗:', e.message);
  }
  console.log(`  → ${candidates.length}件の施策決定事項を検出`);

  const autoExecuted: AutoMeetingResult['autoExecuted'] = [];
  const manualItems: AutoMeetingResult['manualItems'] = [];

  for (const candidate of candidates) {
    const sourceLabel = `緊急会議 ${new Date().toLocaleDateString('ja-JP')}`;
    if (candidate.assignee === 'ai') {
      const directive = await addDirective(
        candidate.text, candidate.category, candidate.priority, sourceLabel, 'ai', 'x',
      );
      try {
        const execution = await executeDirective(directive);
        await saveDirectiveExecution(directive.id, execution);
        if (execution.success) {
          await updateDirectiveStatus(directive.id, 'completed');
          autoExecuted.push({ text: candidate.text.slice(0, 80), result: execution.summary, success: true });
        } else {
          autoExecuted.push({ text: candidate.text.slice(0, 80), result: execution.summary, success: false });
        }
      } catch (e: any) {
        autoExecuted.push({ text: candidate.text.slice(0, 80), result: e.message, success: false });
      }
    } else {
      await addDirective(
        candidate.text, candidate.category, candidate.priority, sourceLabel, 'user', 'x',
      );
      manualItems.push({
        text: candidate.text,
        category: candidate.category,
        priority: candidate.priority,
        rationale: candidate.rationale,
      });
    }
  }

  // ── 会議完了後にデータリセット ────────────────────────────────────────────
  console.log('  🗑  [緊急会議] 旧アカウントデータをリセット中...');
  const resetData = await resetBotData();

  const duration_ms = Date.now() - startAt;

  // ── 完了通知 ──────────────────────────────────────────────────────────────
  const manualLines = manualItems.slice(0, 5).map(m => `• [${m.priority}] ${m.text.slice(0, 60)}`).join('\n');
  await contact.systemAlert(
    '✅ 緊急会議完了 → データリセット済み',
    `凍結インシデント対応会議が完了しました。\n\n` +
    `📋 施策決定: ${candidates.length}件\n` +
    `🤖 AI自動実行: ${autoExecuted.filter(r => r.success).length}/${autoExecuted.length}件成功\n` +
    `👤 要手動確認:\n${manualLines}\n\n` +
    `🗑 リセット完了:\n${resetData.cleared.join('\n')}\n\n` +
    `⏱ 所要時間: ${Math.round(duration_ms / 1000)}秒\n\n` +
    `✨ @gomi_shu_god として新規スタート準備完了`,
  );

  // 会議フルログをメールで送信
  try {
    const fullSession = getMeetingById(session.id);
    if (fullSession) {
      const decisionTexts = candidates.map(c => `[${c.assignee}/${c.priority}/${c.category}] ${c.text}`);
      const summaryLines = [
        `【緊急会議完了】凍結インシデント分析・@gomi_shu_god 新規スタート戦略決定`,
        ``,
        `📋 施策決定: ${candidates.length}件`,
        `🤖 AI自動実行: ${autoExecuted.filter(r => r.success).length}/${autoExecuted.length}件成功`,
        `🗑 リセット: ${resetData.cleared.join(' / ')}`,
        `⏱ 所要時間: ${Math.round(duration_ms / 1000)}秒`,
        ``,
        `【手動確認が必要な事項】`,
        ...manualItems.map(m => `• [${m.priority}] ${m.text}`),
      ];
      await sendMeetingFullLog({
        title,
        sessionId: session.id,
        messages: fullSession.messages,
        summary: summaryLines.join('\n'),
        decisions: decisionTexts,
        duration_ms,
      });
    }
  } catch (e: any) {
    console.warn('  ⚠ [緊急会議] フルログメール送信失敗:', e.message);
  }

  console.log(`  ✅ [緊急会議] 完了: ${candidates.length}件決定 / データリセット完了 (${Math.round(duration_ms / 1000)}秒)`);

  return {
    meetingId: session.id, title, runAt,
    totalDecisions: candidates.length,
    autoExecuted, manualItems, resetData,
    duration_ms,
  };
}
