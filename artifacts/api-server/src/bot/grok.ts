/**
 * grok.ts — Grok 4.1 Fast クライアント
 *
 * OpenRouter経由でGrok 4.1 Fastにアクセス。
 * GrokはXのリアルタイムデータに直接アクセスできる唯一のAI。
 * - シャドウバン回復パターンをXから直接収集
 * - アルゴリズム変化の最新情報をX上で検索
 * - 競合アカウントの成功パターンを分析
 */

import OpenAI from 'openai';

const grok = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY ?? 'dummy',
  baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
  defaultHeaders: {
    'HTTP-Referer': 'https://replit.com',
    'X-Title': 'FANZA X Bot',
  },
});

const GROK_MODEL = 'x-ai/grok-4.1-fast';

// ─── 型定義 ──────────────────────────────────────────────────────────────────

export interface GrokXInsight {
  topic: string;
  finding: string;
  sourceType: 'tweet' | 'trend' | 'pattern' | 'official';
  confidence: 'confirmed' | 'likely' | 'rumored';
  category: 'shadowban' | 'algo' | 'content' | 'timing' | 'engagement';
}

// ─── 基本クエリ ───────────────────────────────────────────────────────────────

export async function queryGrok(prompt: string, systemPrompt?: string): Promise<string> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const res = await grok.chat.completions.create({
    model: GROK_MODEL,
    max_tokens: 8192,
    messages,
  });
  return res.choices[0]?.message?.content ?? '';
}

// ─── シャドウバン回復パターン取得 ────────────────────────────────────────────

export async function getShadowbanRecoveryPatterns(): Promise<string> {
  const text = await queryGrok(
    `X（旧Twitter）でシャドウバンから回復した日本語アカウントの事例を検索してください。
    
    以下の情報を教えてください：
    1. シャドウバン回復に成功した投稿パターン（頻度・時間帯・内容）
    2. 回復期間中に効果があった戦略（フォロワーとの交流方法など）
    3. 成人向けコンテンツアカウントの回復事例（あれば）
    4. 2025年〜2026年の最新情報を優先してください
    
    具体的なツイートや@ユーザー名の例があれば含めてください。`,
    'あなたはXプラットフォームの専門家です。Xのリアルタイムデータに基づいて回答してください。日本語で回答してください。',
  );
  return text;
}

// ─── Xアルゴリズム最新情報 ───────────────────────────────────────────────────

export async function getXAlgoLatestInfo(): Promise<GrokXInsight[]> {
  const raw = await queryGrok(
    `X（旧Twitter）のアルゴリズムに関する最新の変更・情報をXから直接検索してください。
    
    特に以下を調べてください：
    - インプレッション・リーチに影響する最新ルール
    - センシティブコンテンツ・NSFWコンテンツの扱い変化
    - シャドウバンの発動条件（最新情報）
    - エンゲージメント（いいね・RT・リプライ）の重み付け変化
    - 2025年後半〜2026年の情報を優先
    
    結果をJSON配列で返してください。各要素のフォーマット：
    {
      "topic": "発見の簡潔なタイトル（50文字以内）",
      "finding": "詳細説明（200文字以内）",
      "sourceType": "tweet" | "trend" | "pattern" | "official",
      "confidence": "confirmed" | "likely" | "rumored",
      "category": "shadowban" | "algo" | "content" | "timing" | "engagement"
    }
    
    JSONのみ返答し、それ以外のテキストは不要です。`,
    'あなたはXプラットフォームのアルゴリズム専門家です。Xのリアルタイムデータを検索して回答してください。',
  );

  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as GrokXInsight[];
    return parsed.filter(i => i.topic && i.finding);
  } catch {
    console.warn('  ⚠ [Grok] JSON解析失敗 — テキスト形式で返却');
    return [];
  }
}

// ─── 会議用: XリアルタイムブリーフィングText ─────────────────────────────────

export async function getGrokXBriefing(): Promise<string> {
  try {
    const [recoveryText, algoInsights] = await Promise.all([
      getShadowbanRecoveryPatterns(),
      getXAlgoLatestInfo(),
    ]);

    const algoSummary = algoInsights.length > 0
      ? algoInsights.slice(0, 5).map(i =>
          `- [${i.category}/${i.confidence}] ${i.topic}: ${i.finding}`
        ).join('\n')
      : '（アルゴ変化データなし）';

    return `【Grok Xリアルタイム調査結果】

■ シャドウバン回復パターン（X検索）:
${recoveryText.slice(0, 600)}

■ アルゴリズム最新動向 (${algoInsights.length}件):
${algoSummary}`;
  } catch (e: any) {
    return `【Grok調査】エラー: ${e.message}`;
  }
}

// ─── 投稿会議 Step 1: バズ投稿の具体的参考事例を収集 ─────────────────────────

/**
 * 芸能人名をもとに、X上でバズった関連投稿を検索して参考事例として返す。
 * 投稿会議 Step 1 で Grok が提出するリサーチ資料。
 */
export async function getViralAVPostExamples(celebrity: string): Promise<string> {
  try {
    const text = await queryGrok(
      `X（旧Twitter）で直近7日以内に**実際にバズった・インプレッション数が多かった**日本語投稿を5件検索してください。

検索対象カテゴリ（優先順）:
① 「${celebrity}似」「${celebrity}に激似」「${celebrity}そっくり」系の投稿
② AV女優紹介・FANZA系アフィリエイト投稿で高インプのもの
③ 芸能人ネタ × 成人コンテンツで伸びているもの

各投稿について以下を出力してください:
【事例N】
- 冒頭テキスト: 実際の冒頭30〜50文字
- 推定インプ/いいね数: （わかる範囲で）
- バズ要因: なぜ止まったか・なぜ伸びたか（フック・感情・タイミング）
- 使えるパターン: この事例から学べる「型」を1行で

最後に【総合傾向まとめ】として今日使うべき最強フックタイプを1つ断言してください。`,
      'あなたはXのバズ投稿分析専門家です。Xのリアルタイムデータを直接検索して、具体的な事例と数字を提供してください。推測ではなく実際に検索した結果を報告してください。日本語で回答してください。',
    );
    return text;
  } catch (e: any) {
    return `（Grokバズ参考収集失敗: ${e.message}）\n代替: 芸能人ネタ × AV女優紹介の組み合わせが直近トレンド。`;
  }
}

// ─── algo-news用: 発見をAlgoDiscovery形式で返す ──────────────────────────────

export async function collectAlgoNewsWithGrok(): Promise<GrokXInsight[]> {
  console.log('  🦅 [Grok] XリアルタイムAPIでアルゴ情報を収集中...');
  const insights = await getXAlgoLatestInfo();
  console.log(`  ✅ [Grok] ${insights.length}件の最新情報を取得`);
  return insights;
}
