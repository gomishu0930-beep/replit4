import { getAnalytics } from './post-analytics.js';
import { readJson, writeJson } from './cloudStore.js';
import { getProposalFeedback } from './agent-learning-store.js';
import { getRevenueWeightSignals, loadRevenueReports } from './revenue-report-store.js';

export interface AgentWeights {
  status: 'active' | 'insufficient_data';
  updated_at: string;
  sample_size: number;
  min_samples: number;
  pattern_weights: Record<string, number>;
  cta_weights: Record<string, number>;
  work_weights: Record<string, number>;
  reasons: string[];
}

const KEY = 'agent-weights.json';
const DEFAULT_WEIGHTS: AgentWeights = {
  status: 'insufficient_data',
  updated_at: '',
  sample_size: 0,
  min_samples: 20,
  pattern_weights: {},
  cta_weights: {},
  work_weights: {},
  reasons: ['投稿後メトリクスが不足しています'],
};

let cache: AgentWeights = DEFAULT_WEIGHTS;
let loaded = false;

export async function getAgentWeights(): Promise<AgentWeights> {
  if (!loaded) {
    cache = await readJson<AgentWeights>(KEY, DEFAULT_WEIGHTS);
    loaded = true;
  }
  return cache;
}

function clampWeight(value: number): number {
  return Number(Math.max(0.7, Math.min(1.35, value)).toFixed(3));
}

function simpleCtaKey(text: string): string {
  if (/リプ/.test(text)) return 'reply_link';
  if (/プロフィール|プロフ/.test(text)) return 'profile_redirect';
  if (/詳細/.test(text)) return 'detail_cta';
  if (/セール|OFF|割引/.test(text)) return 'sale_cta';
  return 'generic_cta';
}

function simplePatternKey(text: string): string {
  if (/セール|OFF|割引/.test(text)) return 'sale_appeal';
  if (/ランキング|人気|レビュー.*件/.test(text)) return 'ranking_appeal';
  if (/動画|サンプル/.test(text)) return 'video_main';
  if (text.length > 160) return 'long_review';
  return 'genre_appeal';
}

export async function refreshAgentWeights(options: { minSamples?: number } = {}): Promise<AgentWeights> {
  const minSamples = Math.max(5, Number(options.minSamples ?? 20));
  await Promise.all([getAgentWeights(), loadRevenueReports()]);
  const feedback = await getProposalFeedback(300).catch(() => []);
  const revenueSignals = getRevenueWeightSignals();
  const analytics = getAnalytics(180);
  const sampleSize = analytics.filter((row) => row.result === 'posted' && (row.clicks > 0 || row.impressions > 0)).length
    + feedback.length
    + revenueSignals.sampleSize;

  const reasons: string[] = [
    `post_metrics=${analytics.length}`,
    `proposal_feedback=${feedback.length}`,
    `revenue_rows=${revenueSignals.sampleSize}`,
  ];
  if (sampleSize < minSamples) {
    cache = {
      ...DEFAULT_WEIGHTS,
      updated_at: new Date().toISOString(),
      sample_size: sampleSize,
      min_samples: minSamples,
      reasons: [...reasons, `min_samples=${minSamples}未満のため重みは提案へ強反映しません`],
    };
    await writeJson(KEY, cache);
    return cache;
  }

  const patternBuckets = new Map<string, number[]>();
  const ctaBuckets = new Map<string, number[]>();
  for (const row of analytics) {
    if (row.result !== 'posted') continue;
    const impressions = row.impressions || 1;
    const score = (row.clicks * 4 + row.likes + row.reposts * 3 + row.replies * 2) / impressions;
    const pattern = simplePatternKey(row.text);
    const cta = simpleCtaKey(row.text);
    patternBuckets.set(pattern, [...(patternBuckets.get(pattern) ?? []), score]);
    ctaBuckets.set(cta, [...(ctaBuckets.get(cta) ?? []), score]);
  }
  const avg = (values: number[]) => values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  const baseline = avg([...patternBuckets.values()].flat()) || 0.01;
  const toWeights = (buckets: Map<string, number[]>) => Object.fromEntries([...buckets.entries()]
    .map(([key, values]) => [key, clampWeight(avg(values) / baseline)]));
  const maxRevenue = Math.max(1, ...revenueSignals.byProduct.map((row) => row.revenue || row.conversions));
  const workWeights = Object.fromEntries(revenueSignals.byProduct.slice(0, 30)
    .map((row) => [row.id, clampWeight(1 + ((row.revenue || row.conversions) / maxRevenue) * 0.25)]));

  cache = {
    status: 'active',
    updated_at: new Date().toISOString(),
    sample_size: sampleSize,
    min_samples: minSamples,
    pattern_weights: toWeights(patternBuckets),
    cta_weights: toWeights(ctaBuckets),
    work_weights: workWeights,
    reasons,
  };
  await writeJson(KEY, cache);
  return cache;
}
