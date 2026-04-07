/**
 * tasks.ts — デイリー/ウィークリータスク管理
 *
 * - テンプレートタスク（固定）＋会議ディレクティブから動的生成
 * - 完了状態は GCS に永続化
 * - スケジューラーからの自動チェックと、ユーザーの手動チェックを区別
 */
import { readJson, writeJson } from './cloudStore.js';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

export type TaskAssignee = 'user' | 'ai';
export type TaskFrequency = 'daily' | 'weekly';
export type TaskCategory = 'post' | 'check' | 'report' | 'strategy' | 'meeting';

export interface TaskTemplate {
  id: string;
  title: string;
  description: string;
  frequency: TaskFrequency;
  assignee: TaskAssignee;
  category: TaskCategory;
  scheduledTime?: string;   // "10:30 JST"
  scheduledDay?: string;    // "日曜" / "月曜" (weekly only)
  emoji: string;
}

export interface TaskCompletion {
  at: string;   // ISO timestamp
  by: 'user' | 'bot';
}

export interface TasksState {
  completions: Record<string, TaskCompletion>; // key: `{templateId}_{dateKey}`
}

// ─── テンプレート定義（固定タスク）─────────────────────────────────────────

export const TASK_TEMPLATES: TaskTemplate[] = [
  // === デイリー（AI自動） ===
  {
    id: 'daily-imp-post',
    title: '10:30 インプ狙い投稿',
    description: '共感系・人間らしいツイートを自動投稿。ハッシュタグなし・🔞必須。',
    frequency: 'daily',
    assignee: 'ai',
    category: 'post',
    scheduledTime: '10:30 JST',
    emoji: '🤖',
  },
  {
    id: 'daily-celeb-post',
    title: '20:00 芸能人アフィリ投稿',
    description: '芸能人名＋FANZAアフィリリンクを含む投稿を自動生成・投稿。',
    frequency: 'daily',
    assignee: 'ai',
    category: 'post',
    scheduledTime: '20:00 JST（動的）',
    emoji: '🤖',
  },
  {
    id: 'daily-shadowban-check',
    title: '23:00 シャドウバンチェック',
    description: 'アカウントのシャドウバン回復状況を自動確認・記録。',
    frequency: 'daily',
    assignee: 'ai',
    category: 'check',
    scheduledTime: '23:00 JST',
    emoji: '🤖',
  },
  // === デイリー（手動） ===
  {
    id: 'daily-check-analytics',
    title: 'インプレッション・エンゲージメント確認',
    description: 'X Analytics でインプレッション数・いいね・リプライを確認する。',
    frequency: 'daily',
    assignee: 'user',
    category: 'check',
    emoji: '📊',
  },
  {
    id: 'daily-review-posts',
    title: '今日の投稿内容を確認',
    description: 'ボットが投稿したツイートを確認し、問題がないかチェックする。',
    frequency: 'daily',
    assignee: 'user',
    category: 'check',
    emoji: '👀',
  },
  // === ウィークリー（AI自動） ===
  {
    id: 'weekly-campaign-scan',
    title: 'FANZAキャンペーン発見スキャン',
    description: '新キャンペーンIDをディープスキャンして商品プールを更新。',
    frequency: 'weekly',
    assignee: 'ai',
    category: 'check',
    scheduledDay: '日曜',
    scheduledTime: '03:00 JST',
    emoji: '🤖',
  },
  {
    id: 'weekly-perf-report',
    title: 'ウィークリーパフォーマンスレポート',
    description: 'フォロワー推移・投稿統計・外部パターン分析を自動集計してレポート送信。',
    frequency: 'weekly',
    assignee: 'ai',
    category: 'report',
    scheduledDay: '月曜',
    scheduledTime: '08:00 JST',
    emoji: '🤖',
  },
  {
    id: 'weekly-external-monitor',
    title: '外部パターン監視（常時ループ）',
    description: '競合アカウントのトレンドツイートを収集・外部パターンを更新。',
    frequency: 'weekly',
    assignee: 'ai',
    category: 'check',
    emoji: '🤖',
  },
  // === ウィークリー（手動） ===
  {
    id: 'weekly-check-affiliate',
    title: 'FANZA管理画面で売上・クリック確認',
    description: 'FANZA アフィリエイト管理画面にログインしてクリック数・売上を記録する。',
    frequency: 'weekly',
    assignee: 'user',
    category: 'check',
    emoji: '💰',
  },
  {
    id: 'weekly-eval-shadowban',
    title: 'シャドウバン回復状況を評価',
    description: '今週のインプレッション推移を見てシャドウバン解除に向けた戦略を評価する。',
    frequency: 'weekly',
    assignee: 'user',
    category: 'strategy',
    emoji: '🔍',
  },
  {
    id: 'weekly-meeting-review',
    title: '会議室で週次戦略を検討',
    description: 'o3とClaudeと3者会議を開いて次週の戦略・修正点を議論する。',
    frequency: 'weekly',
    assignee: 'user',
    category: 'meeting',
    emoji: '🏛️',
  },
];

// ─── インメモリ状態 ──────────────────────────────────────────────────────────

let tasksState: TasksState = { completions: {} };
const FILE_KEY = 'tasks-state.json';

// ─── JST ヘルパー ────────────────────────────────────────────────────────────

export function jstDateKey(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function jstWeekKey(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  // Monday-based week number
  const d = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function completionKey(templateId: string, frequency: TaskFrequency): string {
  return `${templateId}_${frequency === 'daily' ? jstDateKey() : jstWeekKey()}`;
}

// ─── 初期化 ──────────────────────────────────────────────────────────────────

export async function initTasks(): Promise<void> {
  try {
    const data = await readJson<TasksState>(FILE_KEY, { completions: {} });
    if (data?.completions) {
      tasksState = data;
      // 古い完了記録を掃除（60日以上前）
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 60);
      const cutStr = cutoff.toISOString().slice(0, 10);
      let pruned = false;
      for (const key of Object.keys(tasksState.completions)) {
        const datePart = key.split('_').pop() ?? '';
        if (datePart < cutStr) { delete tasksState.completions[key]; pruned = true; }
      }
      if (pruned) await persist();
    }
  } catch {
    // ファイルなし → 初期状態で継続
  }
}

async function persist(): Promise<void> {
  await writeJson(FILE_KEY, tasksState);
}

// ─── タスクリスト取得 ────────────────────────────────────────────────────────

export interface TaskItem extends TaskTemplate {
  completionKey: string;
  completed: boolean;
  completedAt?: string;
  completedBy?: 'user' | 'bot';
  isDirective?: boolean;
  directiveId?: string;
}

/**
 * 今日のデイリータスク + 今週のウィークリータスクを返す
 * directives: 会議室からの active ディレクティブ (assignee=user) を追加タスクとして含める
 */
export function getTaskList(directives: Array<{ id: string; text: string; category: string; assignee: string }>): {
  daily: TaskItem[];
  weekly: TaskItem[];
  dateKey: string;
  weekKey: string;
} {
  const dateKey = jstDateKey();
  const weekKey = jstWeekKey();

  function toItem(t: TaskTemplate): TaskItem {
    const cKey = completionKey(t.id, t.frequency);
    const comp = tasksState.completions[cKey];
    return {
      ...t,
      completionKey: cKey,
      completed: !!comp,
      completedAt: comp?.at,
      completedBy: comp?.by,
    };
  }

  const daily = TASK_TEMPLATES.filter((t) => t.frequency === 'daily').map(toItem);
  const weekly = TASK_TEMPLATES.filter((t) => t.frequency === 'weekly').map(toItem);

  // 会議ディレクティブ（user担当のもの）をウィークリーに追加（重複なし）
  const existingIds = new Set(TASK_TEMPLATES.map((t) => t.id));
  for (const d of directives) {
    if (d.assignee !== 'user') continue;
    const tid = `directive-${d.id}`;
    if (existingIds.has(tid)) continue;
    const cKey = `${tid}_${weekKey}`;
    const comp = tasksState.completions[cKey];
    weekly.push({
      id: tid,
      title: d.text.length > 40 ? d.text.slice(0, 40) + '…' : d.text,
      description: d.text,
      frequency: 'weekly',
      assignee: 'user',
      category: (d.category as TaskCategory) ?? 'strategy',
      emoji: '📌',
      completionKey: cKey,
      completed: !!comp,
      completedAt: comp?.at,
      completedBy: comp?.by,
      isDirective: true,
      directiveId: d.id,
    });
  }

  return { daily, weekly, dateKey, weekKey };
}

// ─── 完了操作 ────────────────────────────────────────────────────────────────

/** ユーザーが手動でチェック/アンチェック */
export async function toggleTask(completionKey: string, done: boolean): Promise<void> {
  if (done) {
    tasksState.completions[completionKey] = { at: new Date().toISOString(), by: 'user' };
  } else {
    delete tasksState.completions[completionKey];
  }
  await persist();
}

/** スケジューラーが自動完了 */
export async function autoCompleteTask(templateId: string, frequency: TaskFrequency = 'daily'): Promise<void> {
  const cKey = completionKey(templateId, frequency);
  tasksState.completions[cKey] = { at: new Date().toISOString(), by: 'bot' };
  await persist();
}

export { tasksState };
