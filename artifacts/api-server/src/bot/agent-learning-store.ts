import { readJson, writeJson } from './cloudStore.js';

export type AgentProposalFeedbackDecision = 'queued' | 'approved' | 'rejected' | 'posted' | 'failed';

export interface AgentProposalFeedback {
  id: string;
  run_id: string;
  proposal_id: string;
  decision: AgentProposalFeedbackDecision;
  reason?: string;
  queue_item_id?: string;
  created_at: string;
}

interface AgentLearningData {
  proposal_feedback: AgentProposalFeedback[];
}

let cache: AgentLearningData = { proposal_feedback: [] };
let loaded = false;
const KEY = 'agent-learning.json';

export async function loadAgentLearning(): Promise<void> {
  if (loaded) return;
  cache = await readJson<AgentLearningData>(KEY, { proposal_feedback: [] });
  loaded = true;
}

async function save(): Promise<void> {
  cache.proposal_feedback = cache.proposal_feedback.slice(0, 500);
  await writeJson(KEY, cache);
}

export async function recordProposalFeedback(
  feedback: Omit<AgentProposalFeedback, 'id' | 'created_at'>,
): Promise<AgentProposalFeedback> {
  await loadAgentLearning();
  const row: AgentProposalFeedback = {
    ...feedback,
    id: `${feedback.run_id}:${feedback.proposal_id}:${Date.now()}`,
    created_at: new Date().toISOString(),
  };
  cache.proposal_feedback.unshift(row);
  await save();
  return row;
}

export async function getProposalFeedback(limit = 100): Promise<AgentProposalFeedback[]> {
  await loadAgentLearning();
  return cache.proposal_feedback.slice(0, limit);
}
