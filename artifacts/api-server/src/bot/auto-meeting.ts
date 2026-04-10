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
import Anthropic from '@anthropic-ai/sdk';
import {
  createMeetingSession,
  runTrialogue,
  runDeepResearch,
  extractDecisions,
  addDirective,
  saveDirectiveExecution,
  updateDirectiveStatus,
  getMeetingById,
  pushMessageToSession,
} from './meeting.js';
import { executeDirective } from './directive-executor.js';
import { getStats, getDailyImpressionSnapshots, getLatestAlgoInsight, getLatestSnapshot, getPostsAfter, recordPost, resetBotData, setLastPostMeetingResult } from './storage.js';
import { getStrategySummary, getImagePolicy } from './strategy.js';
import { contact, sendMeetingFullLog } from './contact.js';
import { getGrokXBriefing, getViralAVPostExamples } from './grok.js';
import { postTweet, replyToTweet, uploadImages } from './twitter.js';
import { generateImage, buildImagePrompt, isNanobananaEnabled } from './imageGen.js';
import { makeAnthropicClient, buildCelebrityPostContext, generateCelebrityIntroReply, generateCelebrityMainTweet } from './ai.js';
import { pickCelebrity, pickRandom, getCelebrityLikeItems } from './celebrity.js';
import { resolveShortUrl } from './rebrandly.js';
import { getSampleImages } from './fanza.js';
import {
  readPostLog,
  readDecisionLog,
  readAccountMetrics,
  readHypotheses,
  readMeetingLog,
  readAlgoInsights,
  appendMeetingLog,
  isSheetsConfigured,
} from './sheets-writer.js';

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

  // ── Google Sheets 全データ読み込み（Sheetsが唯一の情報源）──────────────────
  let sheetsPostLogSection      = '';
  let sheetsDecisionLogSection  = '';
  let sheetsAccountSection      = '';
  let sheetsHypothesesSection   = '';
  let sheetsMeetingLogSection   = '';
  let sheetsAlgoSection         = '';

  if (isSheetsConfigured()) {
    console.log('  📊 [週次会議] Google Sheets 全シートからデータ読み込み中...');
    try {
      const [sheetsPosts, sheetsDecisions, sheetsMetrics, sheetsHypo, sheetsMeetings, sheetsAlgo] = await Promise.all([
        readPostLog(14),
        readDecisionLog(10),
        readAccountMetrics(14),
        readHypotheses(),
        readMeetingLog(4),
        readAlgoInsights(2),
      ]);

      // PostLog
      if (sheetsPosts.length > 0) {
        const rows = sheetsPosts.map(p => {
          const imp = p.impressions > 0 ? p.impressions : '未計測';
          const clk = p.clicks > 0 ? ` クリック:${p.clicks}` : '';
          return `  - [${p.postType || '-'}] ${p.postedAt.slice(0, 10)} | ${p.celebrity || '-'} | インプ:${imp} | ❤${p.likes} RT:${p.retweets}${clk} | 「${p.tweetText.slice(0, 50)}」`;
        }).join('\n');
        sheetsPostLogSection = `\n### 📊 PostLog（直近${sheetsPosts.length}件・実績つき）\n${rows}`;
        console.log(`  ✅ [週次会議] PostLog ${sheetsPosts.length}件`);
      }

      // DecisionLog
      if (sheetsDecisions.length > 0) {
        const rows = sheetsDecisions.map(d =>
          `  - [${d.priority}/${d.executionType}] ${d.decidedAt.slice(0, 10)} | ${d.text.slice(0, 70)} → ${d.result ? d.result.slice(0, 40) : '結果未記録'}`
        ).join('\n');
        sheetsDecisionLogSection = `\n### 📋 DecisionLog（直近${sheetsDecisions.length}件）\n${rows}`;
        console.log(`  ✅ [週次会議] DecisionLog ${sheetsDecisions.length}件`);
      }

      // AccountMetrics
      if (sheetsMetrics.length > 0) {
        const latest = sheetsMetrics[0];
        const prev   = sheetsMetrics[1];
        const followerTrend = prev
          ? `(${latest.followersCount - prev.followersCount >= 0 ? '+' : ''}${latest.followersCount - prev.followersCount}人/日)`
          : '';
        const rows = sheetsMetrics.slice(0, 7).map(m =>
          `  - ${m.recordedAt.slice(0, 10)} | フォロワー:${m.followersCount}人 | 平均インプ:${m.avgImpressions || '未計測'} | 本日投稿:${m.totalPostsToday}件`
        ).join('\n');
        sheetsAccountSection = `\n### 👥 AccountMetrics（直近7日間）\n- 最新: ${latest.followersCount}人 ${followerTrend} / ツイート総数:${latest.tweetCount}件\n${rows}`;
        console.log(`  ✅ [週次会議] AccountMetrics ${sheetsMetrics.length}件`);
      }

      // Hypotheses
      if (sheetsHypo.length > 0) {
        const statusIcon = (s: string) => s === 'confirmed' ? '✅' : s === 'rejected' ? '❌' : s === 'adjusted' ? '🔧' : '⏳';
        const rows = sheetsHypo.map(h =>
          `  ${statusIcon(h.status)} [${h.id}] ${h.question} → ${h.finding.slice(0, 60) || '未検証'}`
        ).join('\n');
        sheetsHypothesesSection = `\n### 🧪 Hypotheses（仮説 ${sheetsHypo.length}件）\n${rows}`;
        console.log(`  ✅ [週次会議] Hypotheses ${sheetsHypo.length}件`);
      }

      // MeetingLog
      if (sheetsMeetings.length > 0) {
        const rows = sheetsMeetings.map(m =>
          `  - ${m.runAt.slice(0, 10)} | ${m.title} | 決定${m.totalDecisions}件 (自動実行${m.autoSucceeded}/${m.autoExecuted}件成功)`
        ).join('\n');
        sheetsMeetingLogSection = `\n### 🤝 MeetingLog（直近${sheetsMeetings.length}回）\n${rows}`;
        console.log(`  ✅ [週次会議] MeetingLog ${sheetsMeetings.length}件`);
      }

      // AlgoInsights
      if (sheetsAlgo.length > 0) {
        const rows = sheetsAlgo.map(a =>
          `  - ${a.generatedAt.slice(0, 10)} | n=${a.sampleSize} | ${a.briefingSummary.slice(0, 100)}`
        ).join('\n');
        sheetsAlgoSection = `\n### 🔬 AlgoInsights（直近${sheetsAlgo.length}回）\n${rows}`;
        console.log(`  ✅ [週次会議] AlgoInsights ${sheetsAlgo.length}件`);
      }
    } catch (e: any) {
      console.warn('  ⚠ [週次会議] Sheets読み込み失敗 (スキップ):', e.message);
    }
  }

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
【データソース: Google Sheets (PostLog/DecisionLog/AccountMetrics/Hypotheses/MeetingLog/AlgoInsights)】

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Phase 1: 先週の投稿検証 / アカウント状況（全員でレビュー）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### アカウント概況（内部GCSデータ）
- @gomi_shu_god / フォロワー${snapshot?.followersCount ?? '不明'}人
- A/Bテスト: ${abWeek}（W1=20:00枠 / W2=05:00枠 / W3以降=投稿会議3スロット）
- 先週の投稿数: ${lastWeekPosts.length}件 / 7日間平均インプ: ${avgImp}（${trend}）
- 累計投稿数: ${stats.totalPosts}件 / 累計いいね: ${stats.totalLikes}件
- 戦略: ${strategyStr}
${sheetsAccountSection}

### 先週の投稿一覧（GCS内部記録）
${postSummary}
${algoCtx}
${sheetsPostLogSection}
${sheetsDecisionLogSection}
${sheetsHypothesesSection}
${sheetsMeetingLogSection}
${sheetsAlgoSection}

**全員がまずPhase 1を分析し、以下を明確にすること:**
1. PostLogの実績数値（インプ/いいね/RT/クリック）から何が読み取れるか？
2. AccountMetricsのフォロワー増減トレンドをどう評価するか？
3. Hypothesesで「pending」の仮説のうち、今週検証できるものはどれか？
4. DecisionLogの直近決定事項は実施されたか？未実施の理由は？
5. 前回MeetingLogの成果と今週の改善点は？

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

  // ── Sheets: MeetingLog 書き込み ────────────────────────────────────────────
  if (isSheetsConfigured()) {
    appendMeetingLog({
      meetingId:      session.id,
      runAt,
      title,
      topicSummary:   topic.slice(0, 120),
      totalDecisions: candidates.length,
      autoExecuted:   autoExecuted.length,
      autoSucceeded:  autoExecuted.filter(r => r.success).length,
      manualItems:    manualItems.length,
      duration_min:   Math.round(duration_ms / 60000),
    }).catch((e: any) => console.warn('  ⚠ [Sheets] MeetingLog書き込み失敗:', e.message));
  }

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
//  3者順次投稿会議（Grok→GPT→Claude）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 投稿会議 新フロー:
 *   Step 1: Grok   → X上のバズ投稿を5件検索・参考事例として提出
 *   Step 2: GPT    → バズ参考を分析し、Claudeへの最強プロンプトを設計
 *   Step 3: Claude → プロンプトを確定し、実際のツイート本文を生成
 *
 * @returns { grokRefs, gptAnalysis, finalTweet, introReply }
 */
export async function runThreeAIPostMeeting(
  celebrity: string,
  item: any,
  sessionId: string,
  hooks?: string[],
): Promise<{ grokRefs: string; gptAnalysis: string; finalTweet: string; introReply: string }> {
  const jst = () => new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const actress = item.actress?.map((a: any) => a.name).join('・') || item.title.slice(0, 20);
  const title = item.title?.slice(0, 40) ?? '';
  const reviewAvg = item.review?.average ?? '4.5';
  const reviewCount = item.review?.count ?? 0;

  // ── Step 1: Grok — バズ投稿参考収集 ────────────────────────────────────────
  console.log(`  🦅 [3者会議 Step1] Grokがバズ参考を収集中... (${celebrity})`);
  await pushMessageToSession(sessionId, 'user',
    `【3者投稿会議 開始】\n本日の作品: ${celebrity}似 / ${actress} /「${title}」\nレビュー: ⭐${reviewAvg}点（${reviewCount}件）\n\n**Step 1: Grok、X上のバズ投稿を収集・提出してください**`
  );
  const grokRefs = await getViralAVPostExamples(celebrity);
  await pushMessageToSession(sessionId, 'grok',
    `【🦅 Grok — バズ参考提出】\n\n${grokRefs}\n\n---\n以上が本日のX上の参考事例です。GPTはこれを元にClaudeへのプロンプトを設計してください。`
  );
  console.log(`  ✅ [3者会議 Step1] Grokバズ参考収集完了 (${grokRefs.length}文字)`);

  // ── Step 2: GPT — バズ分析 + Claudeへのプロンプト設計 ──────────────────────
  console.log(`  🤖 [3者会議 Step2] GPTがプロンプトを設計中...`);
  const gptResponse = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `あなたはXアフィリエイター専門のコンサルタントです。Grokが提出したバズ投稿の参考事例を分析し、Claudeが今夜最強のツイートを生成するための具体的なプロンプト指示を設計してください。`,
      },
      {
        role: 'user',
        content: `【Grokのバズ参考データ】\n${grokRefs}\n\n【本日の作品情報】\n- 芸能人（ターゲット）: ${celebrity}\n- 出演AV女優: ${actress}\n- 作品タイトル: ${title}\n- レビュー: ⭐${reviewAvg}点（${reviewCount}件）\n\n---\n上記バズ参考を分析して、以下の形式で出力してください:\n\n【バズ分析】\n（なぜこれらの投稿がバズったか — フック・感情トリガー・構造を2〜3点で分析）\n\n【今日の投稿戦略】\n（上記分析から導いた今夜使うべき具体的な手法 — 1〜2点）\n\n【Claudeへのプロンプト指示】\n（これをそのままClaudeに渡す。「${celebrity}に激似の女優ネタ」で今夜最強のツイート本文を生成させるための具体的指示。フック形式・感情トリガー・構造を明記すること）`,
      },
    ],
    max_tokens: 700,
    temperature: 0.7,
  });
  const gptAnalysis = gptResponse.choices[0]?.message?.content ?? '';
  await pushMessageToSession(sessionId, 'gpt',
    `【🤖 GPT — バズ分析・プロンプト設計】\n\n${gptAnalysis}\n\n---\nClaudeは上記【Claudeへのプロンプト指示】に従ってツイート本文を生成してください。`
  );
  console.log(`  ✅ [3者会議 Step2] GPTプロンプト設計完了 (${gptAnalysis.length}文字)`);

  // ── Step 3: Claude — 既存生成関数でツイート本文を確定 ──────────────────────
  // （generateCelebrityMainTweet はassistant prefill + isRefusal()チェック付き）
  console.log(`  🟣 [3者会議 Step3] Claudeが投稿文を生成中...`);

  // GPT分析から「今日の投稿フック」を抽出（なければデフォルト）
  const hookFromGPT = gptAnalysis.match(/【今日の投稿戦略】[^\n]*\n([^\n【]+)/)?.[1]?.trim()
    ?? gptAnalysis.match(/フック[：:]\s*([^\n]{5,40})/)?.[1]?.trim()
    ?? (hooks && hooks.length > 0 ? pickRandom(hooks) : `${celebrity}に激似の女優を見つけてしまった件`);

  const finalTweet = await generateCelebrityMainTweet(celebrity, hookFromGPT, item);
  const introReply = await generateCelebrityIntroReply(hookFromGPT, item);

  await pushMessageToSession(sessionId, 'claude',
    `【🟣 Claude — プロンプト確定・投稿文生成】\n\nGPTの分析・フックを受けて、既存生成関数（isRefusal()チェック+フォールバック付き）で投稿文を生成しました。\n\n**フック採用:** 「${hookFromGPT}」\n\n**メインツイート（確定）:**\n「${finalTweet}」\n\n**リプライ①（女優紹介・確定）:**\n「${introReply}」\n\n---\n🎯 自律実行指令: 上記メインツイートを即時X投稿し、30〜90秒後に女優紹介リプライを追加してください。`
  );
  console.log(`  ✅ [3者会議 Step3] Claude生成完了 — メイン: "${finalTweet.slice(0, 40)}..."`);

  return { grokRefs, gptAnalysis, finalTweet, introReply };
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
  console.log(`\n[${jst()}] 🎙 [投稿会議] 3者会議フロー（Grok→GPT→Claude）開始`);

  // ── Phase 1: 芸能人・作品の選定 ─────────────────────────────────────────
  const mapping = pickCelebrity();
  const items = await getCelebrityLikeItems(mapping, 1);
  if (items.length === 0) {
    console.warn(`[${jst()}] ⚠ [投稿会議] 対象作品が見つかりませんでした`);
    return { meetingId: '', posted: false, reason: '対象作品なし' };
  }
  const item = items[0];
  const celebrity = mapping.celebrity;
  const actress = item.actress?.map((a: any) => a.name).join('・') || item.title.slice(0, 20);
  console.log(`[${jst()}] 🎭 [投稿会議] 対象: ${celebrity} / ${actress}`);

  // 会議セッション作成
  const title = `【3者投稿会議】${celebrity} / ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`;
  const session = await createMeetingSession(title);

  // ── Phase 2: 3者順次会議（Grok→GPT→Claude）────────────────────────────
  console.log(`[${jst()}] 💬 [投稿会議] Phase 2: Grok→GPT→Claude 3者会議開始...`);
  let meetingResult: { grokRefs: string; gptAnalysis: string; finalTweet: string; introReply: string };
  try {
    meetingResult = await runThreeAIPostMeeting(celebrity, item, session.id, mapping.hooks);
  } catch (e: any) {
    console.error(`[${jst()}] ❌ [投稿会議] 3者会議エラー: ${e.message}`);
    return { meetingId: session.id, posted: false, reason: `3者会議エラー: ${e.message}` };
  }

  const { finalTweet, introReply, grokRefs, gptAnalysis } = meetingResult;
  if (!finalTweet || finalTweet.length < 5) {
    console.error(`[${jst()}] ❌ [投稿会議] Claudeのツイート本文が空`);
    return { meetingId: session.id, posted: false, reason: 'Claude生成ツイートが空' };
  }
  console.log(`\n[${jst()}] 📝 [投稿会議] Claude確定ツイート: "${finalTweet.slice(0, 80)}..."`);

  // ── Phase 3: 投稿可否チェック ────────────────────────────────────────────
  const abWeek = getABTestWeek();
  const todayCount = getTodayPostCount();
  if (!options?.bypassDailyLimit && abWeek !== 'normal' && todayCount >= 1) {
    console.log(`[${jst()}] ℹ [投稿会議] ${abWeek}・本日${todayCount}件投稿済み → 投稿スキップ`);
    setLastPostMeetingResult({
      celebrity, actress, title: item.title ?? '',
      generatedAt: new Date().toISOString(),
      step1Grok: grokRefs, step2GPT: gptAnalysis,
      step3Claude: finalTweet, finalTweet, introReply,
      meetingId: session.id,
    });
    await contact.systemAlert(
      '🎙 3者投稿会議完了（投稿スキップ）',
      `${abWeek}制限中のため投稿はスキップ（会議は完了）。\n\nClaude確定ツイート: ${finalTweet}\n\n次回W3以降またはbypassモードで投稿。`,
    );
    return { meetingId: session.id, directive: finalTweet, posted: false, reason: `${abWeek}制限・本日${todayCount}件投稿済み` };
  }

  // ── Phase 4: X投稿（芸能人3連フォーマット）──────────────────────────────
  const tweetText = finalTweet;
  console.log(`\n[${jst()}] 🚀 [投稿会議] Phase 4: X投稿 → "${tweetText.slice(0, 60)}..."`);
  try {
    // ① メインツイート（サンプル画像付き）
    const imageUrls = getSampleImages(item);
    const mediaIds = await uploadImages(imageUrls);
    const tweetId = await postTweet(tweetText, mediaIds);

    // ② リプライ①: 女優紹介（30〜90秒後）
    const waitMs = (30 + Math.floor(Math.random() * 60)) * 1000;
    await new Promise(r => setTimeout(r, waitMs));
    const finalIntroReply = introReply || `👤 ${actress}\n🎬「${item.title?.slice(0, 30)}」\n⭐${item.review?.average ?? '4.5'}点（${item.review?.count ?? 0}件）\n🔗次のリプにリンクあります`;
    const introReplyId = await replyToTweet(tweetId, finalIntroReply);

    // ③ リプライ②: アフィリエイトリンク（20〜60秒後）
    await new Promise(r => setTimeout(r, (20 + Math.floor(Math.random() * 40)) * 1000));
    const reviewAvg2 = parseFloat(item.review?.average ?? '0');
    const reviewCount2 = item.review?.count ?? 0;
    const isHighScore2 = reviewAvg2 >= 4.3 && reviewCount2 >= 25;
    const affiliateURL = await resolveShortUrl(
      item.affiliateURL ?? '',
      isHighScore2 ? (item.content_id ?? item.id) : undefined,
      isHighScore2 ? item.title : undefined,
    );
    await replyToTweet(introReplyId, `🔗 作品ページはこちら👇\n${affiliateURL}`);

    // 記録
    recordPost({ tweetId, replyId: introReplyId, item, text: tweetText, type: 'celebrity' });

    // 投稿会議結果を保存
    setLastPostMeetingResult({
      celebrity, actress, title: item.title ?? '',
      generatedAt: new Date().toISOString(),
      step1Grok: grokRefs, step2GPT: gptAnalysis,
      step3Claude: tweetText, finalTweet: tweetText,
      introReply: finalIntroReply, tweetId, meetingId: session.id,
    });

    console.log(`\n[${jst()}] 🏁 [投稿会議] Phase 4完了！ tweetId: ${tweetId}`);
    await contact.systemAlert(
      `🏁 3者投稿会議→投稿完了`,
      `Grok(参考)→GPT(分析)→Claude(生成) フルサイクル完了。\n\n📝 メインツイート:\n${tweetText}\n\n🔗 tweetId: ${tweetId}`,
    );
    return { meetingId: session.id, directive: tweetText, tweetText, tweetId, posted: true };
  } catch (e: any) {
    console.error(`[${jst()}] ❌ [投稿会議] 投稿エラー: ${e.message}`);
    return { meetingId: session.id, directive: tweetText, tweetText, posted: false, reason: `投稿エラー: ${e.message}` };
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
