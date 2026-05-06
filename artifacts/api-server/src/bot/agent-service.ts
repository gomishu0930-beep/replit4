import type {
  AgentRun,
  AgentRunInput,
  AgentRunOutput,
  ClaudeFlowDiagnostic,
  RiskFlag,
} from './agent-types.js';
import { getAgentRun, getAgentRuns, finishAgentRun, startAgentRun } from './agent-run-store.js';
import { getAnalysisAdapterStatus } from './analysis-adapter.js';
import { scanMarketPosts } from './x-connector.js';
import { buildOwnPostComparisons } from './own-post-service.js';
import { compareMarketWithOwn } from './market-analysis-service.js';
import { analyzeWorksForAgent } from './work-analysis-service.js';
import { buildDraftPackage } from './draft-agent.js';
import { buildLearningSignals, classifyMarketPosts } from './posting-improvement.js';
import { loadRevenueReports } from './revenue-report-store.js';

const DEFAULT_KEYWORDS = ['FANZA', 'DMM', 'アダルト おすすめ'];
const DEFAULT_GENRES = ['人妻', 'OL', '素人', '巨乳', 'セール'];

export function normalizeAgentInput(raw: Partial<AgentRunInput> = {}): AgentRunInput {
  const envAccounts = (process.env.TRACK_ACCOUNTS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^@/, ''))
    .filter(Boolean);
  return {
    keywords: Array.isArray(raw.keywords) && raw.keywords.length > 0
      ? raw.keywords.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 10)
      : DEFAULT_KEYWORDS,
    genres: Array.isArray(raw.genres) && raw.genres.length > 0
      ? raw.genres.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 10)
      : DEFAULT_GENRES,
    accounts: Array.isArray(raw.accounts) && raw.accounts.length > 0
      ? raw.accounts.map(String).map((s) => s.trim().replace(/^@/, '')).filter(Boolean).slice(0, 20)
      : envAccounts,
    maxResults: Math.min(Math.max(Number(raw.maxResults ?? 200), 10), 500),
    ownDays: Math.min(Math.max(Number(raw.ownDays ?? 30), 1), 180),
    proposalCount: Math.min(Math.max(Number(raw.proposalCount ?? 5), 1), 10),
  };
}

export function diagnoseClaudeFlow(marketCount: number, ownCount: number): ClaudeFlowDiagnostic {
  const issues: ClaudeFlowDiagnostic['issues'] = [
    {
      code: 'legacy_claude_flow_adapter_boundary',
      message: 'Claude会議/生成系は即削除せず、AnalysisAdapter境界で診断対象として残します',
      evidence: 'analysis-adapter.ts: claude adapter exposes legacy entry points and common service status',
    },
    {
      code: 'analysis_not_injected_into_scheduler_fanza',
      message: 'スケジューラーのFANZA通常投稿は調査結果よりテンプレート選択を優先しており、分析結果が本文へ戻りにくいです',
      evidence: 'scheduler.postFanzaItem: researchBuzzForItem実行後にpickFanzaTemplateを使用',
    },
    {
      code: 'weekly_review_not_used_by_generation',
      message: '週次レビューは保存されますが、通常の投稿生成コンテキストへ必ず注入される構造ではありません',
      evidence: 'weekly-review.ts -> scheduler.ts/manualGenerateAndQueue の参照なし',
    },
    {
      code: 'metrics_feedback_sparse',
      message: 'impression/click/conversion/revenueの実測が不足すると、文面改善が成果改善に接続しません',
      evidence: `current run market=${marketCount}, own=${ownCount}`,
    },
    {
      code: 'ui_agent_separate_from_common_api',
      message: 'UIのClaude/AI会議系導線は共通Agent APIではなく個別エンドポイントが混在しており、実行結果の追跡が難しいです',
      evidence: 'meeting routes, Discord tools, dashboard analytics panels are separate flows',
    },
  ];
  if (marketCount < 50) {
    issues.push({
      code: 'competitor_data_insufficient',
      message: '競合/市場投稿データが少なく、分析入力が浅くなる可能性があります',
      evidence: `market posts collected=${marketCount}`,
    });
  }
  if (ownCount < 10) {
    issues.push({
      code: 'own_post_comparison_insufficient',
      message: '自分の投稿実績が少なく、差分比較と勝ちパターン抽出の信頼度が低いです',
      evidence: `own posts compared=${ownCount}`,
    });
  }

  return {
    issues,
    adapterStatus: {
      claudeConfigured: Boolean(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL),
      commonAnalysisService: true,
      adapters: getAnalysisAdapterStatus(),
    },
  };
}

export async function runMarketAnalysis(
  rawInput: Partial<AgentRunInput>,
  source: AgentRun['source'] = 'api',
  kind: AgentRun['kind'] = 'market_scan',
): Promise<AgentRun> {
  const input = normalizeAgentInput(rawInput);
  const run = await startAgentRun(kind, input, source);
  try {
    const market = await scanMarketPosts(input);
    const classifiedMarketPosts = classifyMarketPosts(market.posts);
    await loadRevenueReports();
    const ownPosts = buildOwnPostComparisons(input.ownDays);
    const comparison = compareMarketWithOwn(market.posts, ownPosts);
    const fanzaCandidates = await analyzeWorksForAgent(input, classifiedMarketPosts, comparison.winningPatterns);
    const learningSignals = await buildLearningSignals(ownPosts);
    const baseRiskFlags: RiskFlag[] = [
      ...market.risks,
      ...fanzaCandidates.risks,
      ...comparison.gaps.map((gap) => ({ code: 'comparison_gap', severity: 'warning' as const, message: gap })),
    ];
    const draftPackage = await buildDraftPackage(
      input,
      classifiedMarketPosts,
      ownPosts,
      comparison,
      fanzaCandidates.works,
      baseRiskFlags,
      learningSignals,
    );
    const diagnostics = diagnoseClaudeFlow(market.posts.length, ownPosts.length);
    const riskFlags = [
      ...baseRiskFlags,
      ...draftPackage.proposals.flatMap((proposal) => proposal.risk_flags),
    ];
    const output: AgentRunOutput = {
      marketPosts: market.posts,
      classifiedMarketPosts,
      ownPosts,
      comparison,
      recommendedWorks: fanzaCandidates.works,
      proposals: draftPackage.proposals,
      mediaRecommendations: draftPackage.mediaRecommendations,
      scheduleRecommendations: draftPackage.scheduleRecommendations,
      learningSignals,
      recommendationSchema: draftPackage.recommendationSchema,
      diagnostics,
    };
    const costEstimate = Number(((market.posts.length * 0.000002) + 0.001).toFixed(4));
    const completed = await finishAgentRun(run.run_id, {
      output,
      cost_estimate: costEstimate,
      data_count: market.posts.length + ownPosts.length,
      risk_flags: riskFlags,
    }, 'completed');
    return completed ?? run;
  } catch (e: any) {
    const failed = await finishAgentRun(run.run_id, {
      error: e.message ?? String(e),
      risk_flags: [{ code: 'agent_run_failed', severity: 'critical', message: e.message ?? String(e) }],
    }, 'failed');
    return failed ?? run;
  }
}

export { getAgentRun, getAgentRuns };
export { scanMarketPosts as scanMarket } from './x-connector.js';
export { buildOwnPostComparisons } from './own-post-service.js';
export { compareMarketWithOwn } from './market-analysis-service.js';
