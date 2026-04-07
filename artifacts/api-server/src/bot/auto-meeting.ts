/**
 * auto-meeting.ts — 自律AI会議エンジン
 *
 * GPT × Claude が自動的に会議を開き、決定事項を抽出・実行する。
 * ユーザーへは「手動でしかできないこと」だけを通知する。
 *
 * フロー:
 *   1. 現在のパフォーマンスデータからアジェンダを自動生成
 *   2. createMeetingSession → runTrialogue (GPT/Claude 5ラウンド議論)
 *   3. extractDecisions → 決定事項を分類
 *   4. ai担当 → 即時 executeDirective → completed
 *      user担当 → directive保存のみ → ユーザーへ通知
 */

import {
  createMeetingSession,
  runTrialogue,
  extractDecisions,
  addDirective,
  saveDirectiveExecution,
  updateDirectiveStatus,
} from './meeting.js';
import { executeDirective } from './directive-executor.js';
import { getStats, getDailyImpressionSnapshots, getLatestAlgoInsight, getLatestSnapshot } from './storage.js';
import { getStrategySummary } from './strategy.js';
import { contact } from './contact.js';

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

function buildAutoAgenda(): string {
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
    ? `\n\n【最新アルゴ解析（${new Date(latestInsight.generatedAt).toLocaleDateString('ja-JP')}）】\n${latestInsight.briefing?.slice(0, 500) ?? 'データなし'}`
    : '';

  return `【FANZA Xボット自律運営会議】${new Date().toLocaleDateString('ja-JP')} 自動実行

## 現状データ
- フォロワー: ${snapshot?.followersCount ?? '不明'}人（シャドウバン回復中）
- 過去7日平均インプレッション: ${avgImp}（トレンド: ${trend}）
- 累計投稿数: ${stats.totalPosts ?? 0}件
- 現在の戦略: ${strategy}
${algoContext}

## 議論してほしいこと
1. 現在のインプレッション推移を踏まえ、シャドウバン回復の進捗評価と次の最優先アクション
2. コンテンツ・投稿タイミング・テンプレートで今すぐ改善できること（具体的に）
3. AIが自動実行すべき改善アクション vs ユーザーが手動で対応すべき事項の明確な切り分け

結論として「AIが今週中に実行すること」と「ユーザーが確認・対応すること」を明確に合意してください。`;
}

// ─── 自律AI会議の実行 ─────────────────────────────────────────────────────────

export async function runAutonomousMeeting(customTopic?: string): Promise<AutoMeetingResult> {
  const startAt = Date.now();
  const runAt = new Date().toISOString();
  const topic = customTopic ?? buildAutoAgenda();

  console.log('\n  🤝 [自律会議] 自動AI会議を開始...');

  // 1. 会議セッション作成
  const title = `【自律】${new Date().toLocaleDateString('ja-JP')} 週次戦略会議`;
  const session = await createMeetingSession(title);

  // 2. GPT × Claude トリアローグ実行（5ラウンド）
  console.log('  💬 [自律会議] GPT/Claude議論中（5ラウンド）...');
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
        candidate.text, candidate.category, candidate.priority, sourceLabel, 'ai',
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
        candidate.text, candidate.category, candidate.priority, sourceLabel, 'user',
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
