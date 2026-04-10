/**
 * directive-executor.ts — 会議決定事項の自動実行エンジン
 *
 * Claude が決定事項テキストを解析し、実行可能なアクションを判定・実行する。
 *
 * 実行可能アクション:
 *   strategy.update  — 戦略設定（監視間隔・コンテンツ重み）の変更
 *   template.generate — 新しいツイートテンプレートの自動生成
 *   code.codex       — スケジューラー設定・芸能人リストをGPT-4oで自動書き換え
 *   no-op            — 手動対応が必要（自動化不可）
 */

import Anthropic from '@anthropic-ai/sdk';
import { patchStrategyConfig } from './strategy.js';
import { upsertDynamicTemplates } from './storage.js';
import { runCodexPatch } from './codex-agent.js';
import { appendDecisionLog } from './sheets-writer.js';
import type { MeetingDirective, DirectiveExecution } from './meeting.js';

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? 'dummy',
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

// ─── アクション判定プロンプト ─────────────────────────────────────────────────

const ANALYSIS_PROMPT = `あなたはFANZAアフィリエイトXボットの自動実行エンジンです。
会議で決定したディレクティブ（決定事項）を受け取り、自動的に実行できるアクションを判定してください。

【実行可能なアクション】
1. strategy.update — 戦略設定を変更
   - 対象: 監視間隔（monitorIntervalHours: 0.5〜24）、コンテンツ種別の重み（typeWeights）、画像生成ポリシー（imagePolicy）
   - typeWeights のキー: amateur, buzz, rank, sale, random（値: 0〜5）
   - imagePolicy のキー:
       - enableOnUrlPost: boolean — URLを含むツイートにも画像を付けるか（true=付ける, false=付けない）
       - alwaysGenerate:  boolean — 常に画像を生成するか（trueにすると全投稿に画像が付く）
   - ⚠️ 重要: ディレクティブで「明示的に言及されたキーのみ」を変更してください。

2. template.generate — ツイートテンプレートを生成（5〜10件）
   - 対象: buzz, amateur, rank, sale, random いずれかの型のテンプレート
   - 🔞必須、URLプレースホルダー「{{URL}}」を含む、ハッシュタグ禁止
   - 40〜120文字、女優名/作品名はプレースホルダーにしない

3. code.codex — スケジューラー設定・芸能人リストをGPT-4oで自動書き換え（Codexエージェント）
   - 投稿スロット時刻の変更（例: W1を20:00→19:30に変更）
   - W1/W2期間の日付変更（例: W3を4/21〜4/27に追加）
   - 補完ウィンドウ時間の変更（例: 6h→8h）
   - 芸能人リストへの追加・修正（例: 新しい芸能人マッピングを追加）
   - 会議プロンプトのスタイル調整（例: フックの文体を変更）

4. no-op — 自動化不可（手動対応が必要）
   - 例: アカウント申請、外部サービスの操作、SNS上での直接操作

【出力フォーマット（JSON）】
{
  "actionType": "strategy.update" | "template.generate" | "code.codex" | "no-op",
  "reason": "なぜこのアクションを選んだか（1文）",
  "strategyPatch": {             // actionType === "strategy.update" の場合のみ
    "monitorIntervalHours": 数値 | null,
    "typeWeights": { "buzz": 数値 },
    "imagePolicy": {
      "enableOnUrlPost": true | false,
      "alwaysGenerate": true | false
    }
  },
  "templates": [                 // actionType === "template.generate" の場合のみ
    {
      "type": "buzz" | "amateur" | "rank" | "sale" | "random",
      "text": "ツイート本文（{{URL}}含む、🔞含む）",
      "sourceScore": 100
    }
  ]
}`;

// ─── 実行エンジン ─────────────────────────────────────────────────────────────

export async function executeDirective(
  directive: MeetingDirective,
): Promise<DirectiveExecution> {
  const now = new Date().toISOString();

  console.log(`  ⚡ [自動実行] "${directive.text.slice(0, 60)}" を解析中...`);

  // Claude に解析させる
  let analysisJson: any;
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      system: ANALYSIS_PROMPT,
      messages: [
        {
          role: 'user',
          content: `以下の決定事項を実行してください：\n\n【決定事項】\n${directive.text}\n\n【カテゴリ】${directive.category}\n【優先度】${directive.priority}\n\n上記フォーマットのJSONのみ返してください。コードブロック不要。`,
        },
      ],
    });

    const raw = resp.content[0].type === 'text' ? resp.content[0].text : '{}';
    const cleaned = raw.replace(/```json?\n?|```/g, '').trim();
    analysisJson = JSON.parse(cleaned);
  } catch (e: any) {
    console.error('  ❌ [自動実行] Claude解析エラー:', e.message);
    return {
      at: now,
      actionType: 'error',
      summary: `解析エラー: ${e.message}`,
      changes: [],
      success: false,
    };
  }

  const actionType: string = analysisJson.actionType ?? 'no-op';

  // ── strategy.update ──────────────────────────────────────────────────────
  if (actionType === 'strategy.update') {
    const patch: any = {};
    const sp = analysisJson.strategyPatch ?? {};
    if (sp.monitorIntervalHours != null) patch.monitorIntervalHours = sp.monitorIntervalHours;
    if (sp.typeWeights != null) patch.typeWeights = sp.typeWeights;
    if (sp.imagePolicy != null) patch.imagePolicy = sp.imagePolicy;

    if (Object.keys(patch).length === 0) {
      return {
        at: now,
        actionType: 'strategy.update',
        summary: '変更対象が検出されませんでした（no-op扱い）',
        changes: [],
        success: false,
      };
    }

    try {
      const changes = await patchStrategyConfig(patch, directive.text.slice(0, 80), directive.id);
      const summary = changes.length > 0
        ? `戦略設定を更新しました（${changes.length}項目）`
        : '変更不要（既に同じ設定）';
      console.log(`  ✅ [自動実行] 戦略更新: ${changes.join(', ')}`);
      return { at: now, actionType, summary, changes, success: true };
    } catch (e: any) {
      return { at: now, actionType, summary: `設定更新失敗: ${e.message}`, changes: [], success: false };
    }
  }

  // ── template.generate ────────────────────────────────────────────────────
  if (actionType === 'template.generate') {
    const templates: any[] = analysisJson.templates ?? [];
    if (templates.length === 0) {
      return {
        at: now,
        actionType: 'template.generate',
        summary: 'テンプレートが生成されませんでした',
        changes: [],
        success: false,
      };
    }

    // バリデーション: 🔞が含まれているか、URLプレースホルダーがあるか
    const valid = templates.filter(
      (t) => t.text && t.text.includes('🔞') && t.text.includes('{{URL}}'),
    );
    if (valid.length === 0) {
      // もし無効なら再生成は諦め、そのまま使う（ゆるめ）
      return {
        at: now,
        actionType: 'template.generate',
        summary: '生成されたテンプレートが条件を満たしていません（🔞・{{URL}}必須）',
        changes: templates.map((t) => t.text?.slice(0, 50) ?? ''),
        success: false,
      };
    }

    try {
      upsertDynamicTemplates(
        valid.map((t) => ({
          text: t.text,
          type: t.type ?? 'random',
          sourceScore: t.sourceScore ?? 100,
          generatedAt: now,
        })),
      );
      const changes = valid.map((t) => `[${t.type}] ${t.text.slice(0, 60)}...`);
      console.log(`  ✅ [自動実行] テンプレート${valid.length}件を追加`);
      return { at: now, actionType, summary: `ツイートテンプレートを${valid.length}件追加しました`, changes, success: true };
    } catch (e: any) {
      return { at: now, actionType, summary: `テンプレート保存失敗: ${e.message}`, changes: [], success: false };
    }
  }

  // ── code.codex ───────────────────────────────────────────────────────────
  if (actionType === 'code.codex') {
    try {
      const codexResult = await runCodexPatch(
        directive.text,
        `カテゴリ: ${directive.category} / 優先度: ${directive.priority}`,
      );
      const summary = codexResult.success
        ? `[Codex] ${codexResult.configFile} を更新しました（${codexResult.changes.length}項目）`
        : `[Codex] 変更不可: ${codexResult.reason}`;
      console.log(`  ${codexResult.success ? '✅' : 'ℹ️ '} [自動実行] ${summary}`);

      // Sheets にも記録
      await appendDecisionLog({
        decidedAt: now,
        source: directive.source ?? 'directive',
        text: directive.text,
        category: directive.category,
        priority: directive.priority,
        autoExecuted: codexResult.success,
        result: codexResult.changes.join(' / ') || codexResult.reason,
      }).catch(() => {});

      return {
        at: now,
        actionType: 'code.codex',
        summary,
        changes: codexResult.changes,
        success: codexResult.success,
      };
    } catch (e: any) {
      console.error('  ❌ [自動実行] Codexエラー:', e.message);
      return {
        at: now,
        actionType: 'code.codex',
        summary: `Codexエラー: ${e.message}`,
        changes: [],
        success: false,
      };
    }
  }

  // ── no-op ────────────────────────────────────────────────────────────────
  // Sheets にも記録（手動対応が必要な決定事項）
  appendDecisionLog({
    decidedAt: now,
    source: directive.source ?? 'directive',
    text: directive.text,
    category: directive.category,
    priority: directive.priority,
    autoExecuted: false,
    result: '手動対応が必要',
  }).catch(() => {});

  return {
    at: now,
    actionType: 'no-op',
    summary: `手動対応が必要です。理由: ${analysisJson.reason ?? 'このアクションは自動化できません'}`,
    changes: [],
    success: false,
  };
}
