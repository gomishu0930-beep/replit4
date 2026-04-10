/**
 * codex-agent.ts — 自律コード変更エージェント
 *
 * GPT-4o を使い、会議の決定事項に基づいて設定ファイル（GCS JSON）を
 * 自動的に書き換える。TypeScript ソースは触らず、JSON設定のみ変更。
 *
 * 変更可能な設定ファイル（ホワイトリスト）:
 *   scheduler-overrides.json  — 投稿時刻・W期間・補完ウィンドウ
 *   celebrity-config.json     — 芸能人リスト・フック・紹介文
 *   meeting-prompts.json      — 会議フェーズのプロンプト文言
 *
 * ダッシュボードの「管理 > 変更ログ」に全変更を記録する。
 */

import OpenAI from 'openai';
import { readJson, writeJson } from './cloudStore.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── 型定義 ──────────────────────────────────────────────────────────────────

export interface CodexChangeResult {
  success: boolean;
  configFile: string;
  changes: string[];
  patchApplied: Record<string, unknown>;
  reason: string;
  appliedAt: string;
}

// ─── 変更可能な設定ファイルのスキーマ定義 ────────────────────────────────────

const SCHEDULER_OVERRIDES_SCHEMA = `{
  "w1": {
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "slotHour": 20,
    "slotMin": 0
  },
  "w2": {
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "slotHour": 5,
    "slotMin": 0
  },
  "catchupWindowHours": 6,
  "meetingLeadMinutes": 20
}`;

const CELEBRITY_CONFIG_SCHEMA = `{
  "mappings": [
    {
      "celebrity": "芸能人名",
      "hooks": ["フックバリエーション1", "フックバリエーション2"],
      "keyword": "FANZAで似ている女優を検索するキーワード",
      "sort": "review | rank | date",
      "introLines": ["リプライ紹介文1", "リプライ紹介文2"]
    }
  ]
}`;

const MEETING_PROMPTS_SCHEMA = `{
  "phase1_context": "Phase1に追加するコンテキスト文",
  "phase2_instructions": "Grokへの追加指示",
  "post_style_notes": "投稿スタイルに関する追記",
  "avoid_patterns": ["避けるべきパターン1", "避けるべきパターン2"]
}`;

const CONFIG_SCHEMAS: Record<string, { schema: string; description: string }> = {
  'scheduler-overrides.json': {
    schema: SCHEDULER_OVERRIDES_SCHEMA,
    description: '投稿スロット時刻・W1/W2期間・補完ウィンドウ設定',
  },
  'celebrity-config.json': {
    schema: CELEBRITY_CONFIG_SCHEMA,
    description: '芸能人マッピング（名前・フック・検索キーワード・紹介文）',
  },
  'meeting-prompts.json': {
    schema: MEETING_PROMPTS_SCHEMA,
    description: '会議フェーズのプロンプト追記・スタイルノート',
  },
};

// ─── メイン: Codex パッチ実行 ─────────────────────────────────────────────────

export async function runCodexPatch(
  decisionText: string,
  context: string,
): Promise<CodexChangeResult> {
  const now = new Date().toISOString();
  const jst = new Date(Date.now() + 9 * 3600000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  console.log(`\n[${jst}] 🤖 [Codexエージェント] 決定事項を解析中...`);
  console.log(`  📋 決定: "${decisionText.slice(0, 80)}"`);

  // ── Step 1: どのファイルを変更するか GPT-4o に判断させる ──────────────────
  const routingResp = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `あなたはFANZA X Botの自律コード変更エージェントです。
会議の決定事項を受け取り、どの設定ファイルを変更すべきか判断してください。

【変更可能なファイル】
1. scheduler-overrides.json — 投稿時刻・W1/W2期間・補完ウィンドウ変更
2. celebrity-config.json   — 芸能人リストの追加・修正
3. meeting-prompts.json    — 会議プロンプトのスタイル調整

【出力JSON】
{
  "targetFile": "scheduler-overrides.json" | "celebrity-config.json" | "meeting-prompts.json" | "none",
  "reason": "なぜそのファイルを選んだか（1文）",
  "canAutomate": true | false
}`,
      },
      {
        role: 'user',
        content: `【決定事項】\n${decisionText}\n\n【背景】\n${context}`,
      },
    ],
  });

  const routing = JSON.parse(routingResp.choices[0].message.content ?? '{}');

  if (!routing.canAutomate || routing.targetFile === 'none') {
    console.log(`  ℹ️  [Codexエージェント] 自動化不可: ${routing.reason}`);
    return {
      success: false,
      configFile: 'none',
      changes: [],
      patchApplied: {},
      reason: routing.reason ?? '自動化できない変更です',
      appliedAt: now,
    };
  }

  const targetFile = routing.targetFile as string;
  const configDef = CONFIG_SCHEMAS[targetFile];
  if (!configDef) {
    return {
      success: false,
      configFile: targetFile,
      changes: [],
      patchApplied: {},
      reason: `未対応のファイル: ${targetFile}`,
      appliedAt: now,
    };
  }

  console.log(`  🎯 [Codexエージェント] 変更対象: ${targetFile}`);

  // ── Step 2: 現在の設定を読み込む ────────────────────────────────────────
  const current = await readJson(targetFile, {});
  const currentStr = JSON.stringify(current, null, 2);

  // ── Step 3: GPT-4o にパッチを生成させる ─────────────────────────────────
  const patchResp = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `あなたはJSON設定ファイルのパッチ生成エンジンです。
現在の設定と決定事項を受け取り、変更後の完全なJSONを出力してください。

【ファイル】${targetFile}
【説明】${configDef.description}
【スキーマ】\n${configDef.schema}

ルール:
- 変更が必要な箇所のみ修正し、それ以外はそのまま保持する
- 既存データを削除しない（追加・修正のみ）
- 出力は変更後の完全なJSONオブジェクトのみ（説明不要）
- 日付は YYYY-MM-DD 形式`,
      },
      {
        role: 'user',
        content: `【決定事項】\n${decisionText}\n\n【現在の設定】\n${currentStr || '（初期状態・空）'}`,
      },
    ],
  });

  let patched: Record<string, unknown>;
  try {
    patched = JSON.parse(patchResp.choices[0].message.content ?? '{}');
  } catch {
    return {
      success: false,
      configFile: targetFile,
      changes: ['JSONパース失敗'],
      patchApplied: {},
      reason: 'GPT-4oが有効なJSONを返しませんでした',
      appliedAt: now,
    };
  }

  // ── Step 4: 差分を検出して変更点をリスト化 ──────────────────────────────
  const changes = detectChanges(current as Record<string, unknown>, patched);
  if (changes.length === 0) {
    console.log(`  ℹ️  [Codexエージェント] 変更なし（既に同じ設定）`);
    return {
      success: true,
      configFile: targetFile,
      changes: [],
      patchApplied: patched,
      reason: '変更不要（既に同じ設定）',
      appliedAt: now,
    };
  }

  // ── Step 5: GCS に書き込む ────────────────────────────────────────────────
  await writeJson(targetFile, patched);

  console.log(`  ✅ [Codexエージェント] ${targetFile} を更新しました:`);
  changes.forEach((c) => console.log(`     ${c}`));

  return {
    success: true,
    configFile: targetFile,
    changes,
    patchApplied: patched,
    reason: routing.reason ?? '',
    appliedAt: now,
  };
}

// ─── ヘルパー: JSON diff ──────────────────────────────────────────────────────

function detectChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  prefix = '',
): string[] {
  const diffs: string[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const bVal = before[key];
    const aVal = after[key];

    if (JSON.stringify(bVal) === JSON.stringify(aVal)) continue;

    if (
      typeof bVal === 'object' && bVal !== null && !Array.isArray(bVal) &&
      typeof aVal === 'object' && aVal !== null && !Array.isArray(aVal)
    ) {
      diffs.push(
        ...detectChanges(
          bVal as Record<string, unknown>,
          aVal as Record<string, unknown>,
          path,
        ),
      );
    } else if (bVal === undefined) {
      diffs.push(`[追加] ${path}: ${JSON.stringify(aVal)}`);
    } else if (aVal === undefined) {
      diffs.push(`[削除] ${path}: ${JSON.stringify(bVal)}`);
    } else {
      diffs.push(`[変更] ${path}: ${JSON.stringify(bVal)} → ${JSON.stringify(aVal)}`);
    }
  }

  return diffs;
}

// ─── スケジューラーオーバーライドの読み込み ───────────────────────────────────

export interface SchedulerOverrides {
  w1?: { startDate: string; endDate: string; slotHour: number; slotMin: number };
  w2?: { startDate: string; endDate: string; slotHour: number; slotMin: number };
  catchupWindowHours?: number;
  meetingLeadMinutes?: number;
}

let _schedulerOverrides: SchedulerOverrides = {};

export async function loadSchedulerOverrides(): Promise<void> {
  try {
    _schedulerOverrides = await readJson<SchedulerOverrides>('scheduler-overrides.json', {});
    if (Object.keys(_schedulerOverrides).length > 0) {
      console.log('  ✅ [Codexエージェント] scheduler-overrides.json を読み込みました');
    }
  } catch {
    _schedulerOverrides = {};
  }
}

export function getSchedulerOverrides(): SchedulerOverrides {
  return _schedulerOverrides;
}
