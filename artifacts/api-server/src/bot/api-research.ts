/**
 * api-research.ts
 * 「インプ数が伸びそうなAPIを実装したいか？」を o3×Claude×Grok に問い合わせる専用会議
 */

import OpenAI from 'openai';
import { contact } from './contact.js';
import { getGrokXBriefing } from './grok.js';
import { getStats } from './storage.js';
import { addDirective } from './meeting.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function jst() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
}

interface ApiProposal {
  name: string;
  description: string;
  expectedEffect: string;
  difficulty: 'low' | 'medium' | 'high';
  priority: 'high' | 'medium' | 'low';
  implementationHint: string;
}

export interface ApiResearchResult {
  proposals: ApiProposal[];
  summary: string;
  grokInsight: string;
  claudeEval: string;
  o3Pick: string;
}

export async function runApiResearchMeeting(): Promise<ApiResearchResult> {
  console.log(`\n[${jst()}] 🔬 [API調査会議] 開始 — インプ増加APIを o3×Claude×Grok で調査`);

  const stats = getStats();

  // ── Step 1: Grok が X（Twitter）のリアルタイム動向を調査 ────────────────────
  console.log(`[${jst()}] 🦅 [API調査会議] Grok: Xでインプを伸ばすAPI/機能を調査中...`);
  let grokInsight = '';
  try {
    grokInsight = await getGrokXBriefing(`
あなたはTwitter/Xのアフィリエイトボット戦略の専門家です。
FANZAアダルトアフィリエイトボット（@gomi_shu_god）のインプレッション数を増やすために
今すぐ実装できそうな「外部API・サービス・X APIの機能」を調査してください。

現在の状況:
- 投稿数: ${stats.totalPosts}件（1日1投稿）
- シャドウバン回復モード中
- Nanobanana2（画像生成）は実装済み

以下の観点で調査してください:
1. X API v2で使えるがまだ未実装の機能（スレッド投稿・投票・アナリティクス等）
2. サードパーティAPIで効果的なもの（トレンド取得・スケジューリング・エンゲージメント分析等）
3. 日本のアダルトアフィリエイト界隈でバズらせるためのAPIや自動化手法
4. ハッシュタグ最適化API（RiteTag等）
5. X アルゴリズムを活用したエンゲージメント向上施策（返信ループ・引用RT等）

具体的なAPI名・サービス名・エンドポイント名を挙げて報告してください。
`);
  } catch (e: any) {
    grokInsight = `Grok調査エラー: ${e.message}`;
  }
  console.log(`[${jst()}] ✅ [API調査会議] Grok調査完了`);

  // ── Step 2: o3 が技術的実現性を評価 ────────────────────────────────────────
  console.log(`[${jst()}] 🧠 [API調査会議] o3: 技術的実現性を評価中...`);
  let o3Pick = '';
  try {
    const o3Res = await openai.chat.completions.create({
      model: 'o3',
      messages: [
        {
          role: 'user',
          content: `あなたはNode.js/TypeScriptエンジニアです。
以下はGrokが調査したTwitter/XのインプレッションAPIに関するレポートです。

Grokレポート:
${grokInsight.slice(0, 3000)}

このFANZAアフィリエイトボット（Express + TypeScript + twitter-api-v2）に対して、
「実装難易度が低く・効果が高い」TOP 3のAPIや機能を選んで、
JSON形式で回答してください:

\`\`\`json
{
  "picks": [
    {
      "name": "API/機能名",
      "reason": "選定理由（インプへの効果）",
      "difficulty": "low|medium|high",
      "implementationHint": "実装の具体的なヒント（エンドポイント名やライブラリ名含む）"
    }
  ]
}
\`\`\`

JSONのみ出力してください。`,
        },
      ],
    });
    o3Pick = o3Res.choices[0]?.message?.content?.trim() ?? '';
  } catch (e: any) {
    o3Pick = `o3評価エラー: ${e.message}`;
  }
  console.log(`[${jst()}] ✅ [API調査会議] o3評価完了`);

  // ── Step 3: Claude が UX・リスク・優先度を評価 ──────────────────────────────
  console.log(`[${jst()}] 🤖 [API調査会議] Claude: 優先度・リスク評価中...`);
  let claudeEval = '';
  try {
    const claudeRes = await openai.chat.completions.create({
      model: 'claude-sonnet-4-5',
      messages: [
        {
          role: 'user',
          content: `あなたはX（Twitter）アフィリエイト戦略のコンサルタントです。

Grokレポート（抜粋）:
${grokInsight.slice(0, 2000)}

o3の技術選定:
${o3Pick.slice(0, 1500)}

シャドウバン回復中のアカウント（@gomi_shu_god）において、
上記の提案についてリスク評価・優先順位付けをしてください。

特に以下を重視:
- アカウント凍結リスクが低いもの
- すぐに実装可能なもの（1〜2日以内）
- インプレッション増加効果が期待できるもの

最終的な推奨リスト（優先度順）と理由を日本語で回答してください。`,
        },
      ],
    });
    claudeEval = claudeRes.choices[0]?.message?.content?.trim() ?? '';
  } catch (e: any) {
    claudeEval = `Claude評価エラー: ${e.message}`;
  }
  console.log(`[${jst()}] ✅ [API調査会議] Claude評価完了`);

  // ── Step 4: o3で提案をパース → 構造化データに変換 ──────────────────────────
  let proposals: ApiProposal[] = [];
  try {
    const jsonMatch = o3Pick.match(/```json\s*([\s\S]*?)```/) ?? o3Pick.match(/(\{[\s\S]*\})/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      proposals = (parsed.picks ?? []).map((p: any) => ({
        name: p.name ?? '不明',
        description: p.reason ?? '',
        expectedEffect: 'インプレッション増加',
        difficulty: p.difficulty ?? 'medium',
        priority: 'high',
        implementationHint: p.implementationHint ?? '',
      }));
    }
  } catch {
    proposals = [];
  }

  // ── Step 5: サマリー生成 ────────────────────────────────────────────────────
  const summary = `
🔬 API調査会議 完了 [${jst()}]

📊 調査内容: インプレッション増加のための実装候補API
👥 参加: o3（技術選定） × Claude（リスク評価） × Grok（リアルタイム調査）

=== Grok調査結果 ===
${grokInsight.slice(0, 800)}

=== o3の技術選定（TOP3） ===
${o3Pick.slice(0, 800)}

=== Claudeの優先度評価 ===
${claudeEval.slice(0, 800)}

=== 構造化提案 (${proposals.length}件) ===
${proposals.map((p, i) => `${i + 1}. [${p.priority.toUpperCase()}] ${p.name}\n   → ${p.description.slice(0, 100)}\n   実装: ${p.implementationHint.slice(0, 100)}`).join('\n\n')}
`.trim();

  // ── Step 6: メール送信 ──────────────────────────────────────────────────────
  try {
    await contact.systemAlert('🔬 API調査会議 完了', summary);
    console.log(`[${jst()}] 📧 [API調査会議] メール送信完了`);
  } catch (e: any) {
    console.warn(`[${jst()}] ⚠ [API調査会議] メール送信エラー: ${e.message}`);
  }

  // ── Step 7: 会議決定事項として登録 ─────────────────────────────────────────
  for (const p of proposals.slice(0, 3)) {
    try {
      await addDirective(
        `【API実装候補】${p.name}: ${p.description.slice(0, 100)}`,
        'tech',
        p.priority as 'high' | 'medium' | 'low',
        'API調査会議',
        'user',
        'x',
      );
    } catch {/* 無視 */}
  }

  console.log(`[${jst()}] 🏁 [API調査会議] 完了 → ${proposals.length}件の提案を生成`);
  return { proposals, summary, grokInsight, claudeEval, o3Pick };
}
