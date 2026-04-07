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
import { getStats, getDailyImpressionSnapshots, getLatestAlgoInsight, getLatestSnapshot, getPostsAfter, recordPost } from './storage.js';
import { getStrategySummary } from './strategy.js';
import { contact } from './contact.js';
import { getGrokXBriefing } from './grok.js';
import { postTweet } from './twitter.js';

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
- @suguhalove0419 / フォロワー${snapshot?.followersCount ?? '不明'}人 / シャドウバン回復中
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
    const now = new Date();
    const weekStr = now >= new Date('2026-04-14') ? 'W2(05:00枠)' : 'W1(10:30枠)';
    const researchTopic = `2026年最新のX(Twitter)シャドウバン回復戦略・FANZA/成人向けアフィリエイトアカウントのアルゴリズム攻略法。${weekStr}投稿A/Bテスト中（フォロワー341人・日本語アカウント）。インプレッション改善と外部からの流入増加のための具体的手法を調査してください。`;
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
- @suguhalove0419 / フォロワー${snapshot?.followersCount ?? '不明'}人 / シャドウバン回復中
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
## Phase 3: 生成文の確定（最終ラウンドで必ず1本に決定）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**o3とClaudeはそれぞれ「今夜最強の投稿」を1本提案せよ（必ずツイート本文まで書くこと）:**
- FANZAアフィリ・インプ型・共感型・時事ネタ・挑発フック・Pollなど形式は完全自由
- 日本語140文字以内・🔞表現可・具体的な本文を必ず書くこと
- Phase 1・2の分析を必ず根拠に含めること

**Grokが最終裁定（最終ラウンドで必須フォーマット）:**
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

  // ── Grok指令抽出 ─────────────────────────────────────────────────────────
  const updatedSession = getMeetingById(session.id);
  const grokMessages = (updatedSession?.messages ?? []).filter(m => m.speaker === 'grok');
  const lastGrok = grokMessages[grokMessages.length - 1];
  const directiveMatch = lastGrok?.content.match(/🎯\s*自律実行指令[：:]\s*(.+?)(?:\n|$)/s);

  if (!directiveMatch) {
    console.warn(`[${jst()}] ⚠ [投稿会議] Grok指令（🎯自律実行指令）が見つかりません`);
    return { meetingId: session.id, posted: false, reason: 'Grok指令なし（情報収集のみ完了）' };
  }
  const directiveText = directiveMatch[1].trim();
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

  // ── Phase 4: X投稿 ───────────────────────────────────────────────────────
  console.log(`\n[${jst()}] 🚀 [投稿会議] Phase 4: X投稿 → "${tweetText.slice(0, 60)}..."`);
  try {
    const tweetId = await postTweet(tweetText, []);
    recordPost({ tweetId, replyId: '', text: tweetText, type: 'meeting-post' });
    console.log(`\n[${jst()}] 🏁 [投稿会議] Phase 4完了！ tweetId: ${tweetId}`);
    await contact.systemAlert(
      '🏁 投稿会議→投稿完了',
      `Phase 1-4フルサイクル完了。Grok裁定に基づき自律投稿しました。\n\n📝 投稿内容:\n${tweetText}\n\n🔗 tweetId: ${tweetId}`,
    );
    return { meetingId: session.id, directive: directiveText, tweetText, tweetId, posted: true };
  } catch (e: any) {
    console.error(`[${jst()}] ❌ [投稿会議] 投稿エラー: ${e.message}`);
    return { meetingId: session.id, directive: directiveText, tweetText, posted: false, reason: `投稿エラー: ${e.message}` };
  }
}
