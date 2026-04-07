/**
 * algo-news.ts
 * Xアルゴリズム最新情報の自動収集モジュール
 *
 * OpenAI Responses API (web_search_preview) でリアルタイム検索し、
 * 新しいルール候補を AlgoDiscovery として保存する。
 * 毎週月曜 08:30 JST に自動実行（アルゴ解析ブリーフィングの直後）。
 */

import OpenAI from 'openai';
import { saveAlgoDiscovery, AlgoDiscovery } from './storage.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── 検索クエリ ───────────────────────────────────────────────────────────────

const SEARCH_QUERIES = [
  'Twitter X algorithm changes 2025 ranking engagement',
  'X algorithm update impressions reach 2025',
  'Twitter shadowban algorithm sensitive content 2025',
];

// ─── カテゴリ推定 ─────────────────────────────────────────────────────────────

function guessCategory(text: string): AlgoDiscovery['category'] {
  const t = text.toLowerCase();
  if (t.includes('nsfw') || t.includes('sensitive') || t.includes('adult') || t.includes('shadowban')) return 'nsfw';
  if (t.includes('pipeline') || t.includes('distribution') || t.includes('outofnetwork') || t.includes('reach')) return 'pipeline';
  if (t.includes('score') || t.includes('rank') || t.includes('weight') || t.includes('reply') || t.includes('bookmark')) return 'scoring';
  return 'other';
}

// ─── メイン: 検索 & 抽出 ─────────────────────────────────────────────────────

export async function collectAlgoNews(): Promise<AlgoDiscovery[]> {
  console.log('\n  📡 [アルゴニュース] Xアルゴリズム最新情報を検索中...');

  const allFindings: AlgoDiscovery[] = [];

  for (const query of SEARCH_QUERIES) {
    try {
      // OpenAI Responses API — web_search_preview ツールでリアルタイム検索
      const response = await (openai as any).responses.create({
        model: 'gpt-4o',
        tools: [{ type: 'web_search_preview' }],
        input: `Search for: "${query}"

You are a strict fact extractor for X (Twitter) algorithm behavior.
From the search results, extract ONLY confirmed or highly credible findings from the last 12 months.
Ignore speculation, opinion pieces, and unverified claims.

Return a JSON array of findings. Each finding must have:
- title: Short rule title (≤60 chars)
- detail: Explanation with specific evidence from source (≤200 chars)
- sourceUrl: URL of the source article/post
- sourceDesc: Brief source description (e.g., "X official blog", "Verified X post by @user")
- confidence: one of "confirmed" | "likely" | "rumored"
- category: one of "scoring" | "pipeline" | "nsfw" | "other"

If no credible findings, return empty array [].
Only return the JSON array, no other text.`,
      });

      const outputText: string = response.output_text ?? '';
      if (!outputText.trim()) continue;

      // JSON抽出
      const jsonMatch = outputText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) continue;

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        title: string;
        detail: string;
        sourceUrl: string;
        sourceDesc: string;
        confidence: string;
        category: string;
      }>;

      for (const item of parsed) {
        const discovery: AlgoDiscovery = {
          id: `discovery-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          discoveredAt: new Date().toISOString(),
          title: item.title?.slice(0, 80) ?? '(不明)',
          detail: item.detail?.slice(0, 300) ?? '',
          sourceUrl: item.sourceUrl ?? '',
          sourceDesc: item.sourceDesc ?? '',
          confidence: (['confirmed', 'likely', 'rumored'].includes(item.confidence)
            ? item.confidence : 'rumored') as AlgoDiscovery['confidence'],
          category: (['scoring', 'pipeline', 'nsfw', 'other'].includes(item.category)
            ? item.category : guessCategory(item.detail)) as AlgoDiscovery['category'],
          status: 'pending',
          searchQuery: query,
        };
        allFindings.push(discovery);
        saveAlgoDiscovery(discovery);
      }

      console.log(`  ✅ [${query.slice(0, 30)}...] ${parsed.length}件発見`);
    } catch (err: any) {
      console.warn(`  ⚠ 検索失敗 [${query.slice(0, 30)}]: ${err.message}`);
    }

    // レート制限対策: クエリ間に2秒待機
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`  📡 [アルゴニュース] 完了: 合計 ${allFindings.length}件の発見を保存`);
  return allFindings;
}
