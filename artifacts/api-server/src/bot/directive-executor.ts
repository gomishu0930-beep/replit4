/**
 * directive-executor.ts — 会議決定事項の自動実行エンジン
 *
 * Claude が決定事項テキストを解析し、実行可能なアクションを判定・実行する。
 *
 * 実行可能アクション:
 *   strategy.update  — 戦略設定（監視間隔・コンテンツ重み）の変更
 *   template.generate — 新しいツイートテンプレートの自動生成
 *   recovery.update  — シャドウバン回復モードの設定変更
 *   no-op            — 手動対応が必要（自動化不可）
 */

import Anthropic from '@anthropic-ai/sdk';
import { patchStrategyConfig } from './strategy.js';
import { upsertDynamicTemplates } from './storage.js';
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
   - 対象: 監視間隔（monitorIntervalHours: 0.5〜24）、コンテンツ種別の重み（typeWeights）
   - typeWeights のキー: amateur, buzz, rank, sale, random（値: 0〜5）
   - ⚠️ 重要: ディレクティブで「明示的に言及されたキーのみ」を変更してください。
     言及されていない他のキーは絶対に変更しないこと（nullや0にしない）。
   - 例: 「buzzを強化」→ buzzだけを変更、他のキーはstrategyPatch.typeWeightsに含めない

2. template.generate — ツイートテンプレートを生成（5〜10件）
   - 対象: buzz, amateur, rank, sale, random いずれかの型のテンプレート
   - 🔞必須、URLプレースホルダー「{{URL}}」を含む、ハッシュタグ禁止
   - 40〜120文字、女優名/作品名はプレースホルダーにしない

3. no-op — 自動化不可（手動対応が必要）
   - 例: アカウント申請、ツールの設定、外部サービスの操作、SNSの操作

【出力フォーマット（JSON）】
{
  "actionType": "strategy.update" | "template.generate" | "no-op",
  "reason": "なぜこのアクションを選んだか（1文）",
  "strategyPatch": {             // actionType === "strategy.update" の場合のみ
    "monitorIntervalHours": 数値 | null,
    "typeWeights": { "buzz": 数値 }   // 明示的に言及されたキーのみ含める
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
      const changes = await patchStrategyConfig(patch, directive.text.slice(0, 80));
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

  // ── no-op ────────────────────────────────────────────────────────────────
  return {
    at: now,
    actionType: 'no-op',
    summary: `手動対応が必要です。理由: ${analysisJson.reason ?? 'このアクションは自動化できません'}`,
    changes: [],
    success: false,
  };
}
