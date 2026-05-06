import type { AgentRunInput, ClassifiedMarketPost, PatternSummary, RiskFlag } from './agent-types.js';
import { scoreFanzaWorkCandidates } from './posting-improvement.js';

export async function analyzeWorksForAgent(
  input: AgentRunInput,
  marketPosts: ClassifiedMarketPost[],
  winningPatterns: PatternSummary[],
): Promise<Awaited<ReturnType<typeof scoreFanzaWorkCandidates>> & { risks: RiskFlag[] }> {
  return scoreFanzaWorkCandidates(input, marketPosts, winningPatterns);
}
