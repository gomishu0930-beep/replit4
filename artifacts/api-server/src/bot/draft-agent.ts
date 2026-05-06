import type {
  AgentRunInput,
  ClassifiedMarketPost,
  FanzaWorkCandidate,
  LearningSignal,
  MarketComparisonSummary,
  OwnPostComparison,
  RiskFlag,
} from './agent-types.js';
import {
  buildMediaRecommendations,
  buildRecommendationSchema,
  buildScheduleRecommendations,
  generateImprovedDraftProposals,
} from './posting-improvement.js';

export function buildDraftPackage(
  input: AgentRunInput,
  marketPosts: ClassifiedMarketPost[],
  ownPosts: OwnPostComparison[],
  comparison: MarketComparisonSummary,
  works: FanzaWorkCandidate[],
  riskFlags: RiskFlag[],
  learningSignals: LearningSignal[],
) {
  const mediaRecommendations = buildMediaRecommendations(comparison.winningPatterns, works);
  const scheduleRecommendations = buildScheduleRecommendations(comparison);
  const proposals = generateImprovedDraftProposals(
    input,
    marketPosts,
    ownPosts,
    comparison,
    works,
    mediaRecommendations,
    scheduleRecommendations,
  );
  const recommendationSchema = buildRecommendationSchema(
    works,
    comparison.winningPatterns,
    comparison.ownAccountGaps,
    proposals,
    mediaRecommendations,
    scheduleRecommendations,
    [...riskFlags, ...proposals.flatMap((p) => p.risk_flags)],
    learningSignals,
  );
  return { mediaRecommendations, scheduleRecommendations, proposals, recommendationSchema };
}
