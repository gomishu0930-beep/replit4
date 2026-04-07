/**
 * algo-news.ts
 * Xアルゴリズム最新情報の自動収集モジュール
 *
 * 2つのソースを並行実行してマージ:
 *   1. Grok 4.1 Fast — Xのリアルタイムデータに直接アクセス（メイン）
 *   2. OpenAI web_search — Web全体を検索（補完）
 *
 * 毎週月曜 08:30 JST に自動実行（アルゴ解析ブリーフィングの直後）。
 */

import OpenAI from 'openai';
import { saveAlgoDiscovery, AlgoDiscovery } from './storage.js';
import { collectAlgoNewsWithGrok } from './grok.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── OpenAI web_search クエリ（Web補完用） ────────────────────────────────────

const WEB_SEARCH_QUERIES = [
  'Twitter X algorithm update shadowban recovery 2026',
  'X platform NSFW sensitive content algorithm rules 2026',
];

// ─── カテゴリ推定 ─────────────────────────────────────────────────────────────

function guessCategory(text: string): AlgoDiscovery['category'] {
  const t = text.toLowerCase();
  if (t.includes('nsfw') || t.includes('sensitive') || t.includes('adult') || t.includes('shadowban')) return 'nsfw';
  if (t.includes('pipeline') || t.includes('distribution') || t.includes('outofnetwork') || t.includes('reach')) return 'pipeline';
  if (t.includes('score') || t.includes('rank') || t.includes('weight') || t.includes('reply') || t.includes('bookmark')) return 'scoring';
  return 'other';
}

// ─── OpenAI web_search（Web補完） ─────────────────────────────────────────────

async function collectFromWebSearch(): Promise<AlgoDiscovery[]> {
  const findings: AlgoDiscovery[] = [];
  for (const query of WEB_SEARCH_QUERIES) {
    try {
      const response = await (openai as any).responses.create({
        model: 'gpt-4o',
        tools: [{ type: 'web_search_preview' }],
        input: `Search for: "${query}"

You are a strict fact extractor for X (Twitter) algorithm behavior.
From the search results, extract ONLY confirmed or highly credible findings from the last 12 months.
Ignore speculation and unverified claims.

Return a JSON array. Each element:
- title: Short rule title (≤60 chars)
- detail: Explanation with evidence from source (≤200 chars)
- sourceUrl: URL
- sourceDesc: Brief source description
- confidence: "confirmed" | "likely" | "rumored"
- category: "scoring" | "pipeline" | "nsfw" | "other"

If no credible findings, return []. Only return the JSON array.`,
      });

      const outputText: string = response.output_text ?? '';
      const jsonMatch = outputText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) continue;

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        title: string; detail: string; sourceUrl: string;
        sourceDesc: string; confidence: string; category: string;
      }>;

      for (const item of parsed) {
        findings.push({
          id: `discovery-web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          discoveredAt: new Date().toISOString(),
          title: item.title?.slice(0, 80) ?? '(不明)',
          detail: item.detail?.slice(0, 300) ?? '',
          sourceUrl: item.sourceUrl ?? '',
          sourceDesc: item.sourceDesc ?? 'OpenAI Web検索',
          confidence: (['confirmed', 'likely', 'rumored'].includes(item.confidence)
            ? item.confidence : 'rumored') as AlgoDiscovery['confidence'],
          category: (['scoring', 'pipeline', 'nsfw', 'other'].includes(item.category)
            ? item.category : guessCategory(item.detail)) as AlgoDiscovery['category'],
          status: 'pending',
          searchQuery: query,
        });
      }
      console.log(`  🌐 [WebSearch] "${query.slice(0, 30)}..." → ${parsed.length}件`);
    } catch (err: any) {
      console.warn(`  ⚠ [WebSearch] 失敗: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return findings;
}

// ─── Grokのinsightを AlgoDiscovery形式に変換 ─────────────────────────────────

const GROK_CAT_MAP: Record<string, AlgoDiscovery['category']> = {
  shadowban: 'nsfw',
  algo:      'scoring',
  content:   'nsfw',
  timing:    'other',
  engagement:'scoring',
};

async function collectFromGrok(): Promise<AlgoDiscovery[]> {
  const insights = await collectAlgoNewsWithGrok();
  return insights.map(insight => ({
    id: `discovery-grok-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    discoveredAt: new Date().toISOString(),
    title: insight.topic.slice(0, 80),
    detail: insight.finding.slice(0, 300),
    sourceUrl: '',
    sourceDesc: 'Grok 4.1 Fast（Xリアルタイムデータ）',
    confidence: insight.confidence,
    category: GROK_CAT_MAP[insight.category] ?? 'other',
    status: 'pending' as const,
    searchQuery: 'Grok X direct search',
  }));
}

// ─── メイン: Grok + WebSearch を並行実行してマージ ────────────────────────────

export async function collectAlgoNews(): Promise<AlgoDiscovery[]> {
  console.log('\n  📡 [アルゴニュース] Grok(Xリアルタイム) + WebSearch 並行実行...');

  const [grokFindings, webFindings] = await Promise.allSettled([
    collectFromGrok(),
    collectFromWebSearch(),
  ]);

  const allFindings: AlgoDiscovery[] = [
    ...(grokFindings.status === 'fulfilled' ? grokFindings.value : []),
    ...(webFindings.status === 'fulfilled' ? webFindings.value : []),
  ];

  if (grokFindings.status === 'rejected') {
    console.warn('  ⚠ [Grok] 失敗:', grokFindings.reason?.message);
  }
  if (webFindings.status === 'rejected') {
    console.warn('  ⚠ [WebSearch] 失敗:', webFindings.reason?.message);
  }

  // 重複排除（タイトルの先頭30文字が同じものはスキップ）
  const seen = new Set<string>();
  const unique = allFindings.filter(f => {
    const key = f.title.slice(0, 30).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // GCS保存
  for (const discovery of unique) {
    saveAlgoDiscovery(discovery);
  }

  const pending = unique.filter(d => d.status === 'pending').length;
  console.log(`  📡 [アルゴニュース] 完了: Grok ${grokFindings.status === 'fulfilled' ? grokFindings.value.length : 0}件 + Web ${webFindings.status === 'fulfilled' ? webFindings.value.length : 0}件 → ユニーク ${unique.length}件 (要確認: ${pending}件)`);

  return unique;
}
