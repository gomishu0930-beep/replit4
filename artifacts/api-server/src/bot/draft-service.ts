import type { AgentRun, DraftProposal } from './agent-types.js';
import { runMarketAnalysis, getAgentRun, getAgentRuns, normalizeAgentInput } from './agent-service.js';
import { recordProposalFeedback } from './agent-learning-store.js';
import { validateProposalSchema } from './compliance-guard.js';
import {
  approveQueueItem,
  enqueuePost,
  getQueue,
  getQueueItem,
  rejectQueueItem,
  scheduleQueueItem,
  type QueueItem,
} from './post-queue.js';

export interface DraftResolution {
  draft_id: string;
  proposal?: DraftProposal;
  run?: AgentRun;
  queueItem?: QueueItem;
}

function sourceFromBody(value: any): AgentRun['source'] {
  return value === 'discord' ? 'discord' : value === 'ui' ? 'ui' : value === 'test' ? 'test' : 'api';
}

export async function createDraftRun(rawInput: any, source: AgentRun['source'] = 'api'): Promise<AgentRun> {
  const input = normalizeAgentInput({
    ...(rawInput ?? {}),
    proposalCount: Number(rawInput?.proposalCount ?? rawInput?.proposals ?? 5),
  });
  return runMarketAnalysis(input, source, 'draft');
}

export async function createDraftRunFromRequest(body: any): Promise<AgentRun> {
  return createDraftRun(body, sourceFromBody(body?.source));
}

export async function resolveDraft(draftId: string): Promise<DraftResolution | null> {
  const queueItem = getQueueItem(draftId) ?? getQueue().find((item) => item.id.startsWith(draftId));
  if (queueItem) {
    const run = queueItem.agentRunId ? await getAgentRun(queueItem.agentRunId) : null;
    const proposal = run?.output?.proposals.find((p) => p.id === queueItem.agentProposalId);
    return { draft_id: queueItem.id, proposal, run: run ?? undefined, queueItem };
  }

  const runs = await getAgentRuns(100);
  for (const run of runs) {
    const proposal = run.output?.proposals.find((p) => p.id === draftId || p.id.startsWith(draftId));
    if (proposal) return { draft_id: proposal.id, proposal, run };
  }
  return null;
}

export async function materializeDraft(draftId: string, reason?: string): Promise<DraftResolution> {
  const resolved = await resolveDraft(draftId);
  if (!resolved) throw new Error('draft が見つかりません');
  if (resolved.queueItem) return resolved;
  const proposal = resolved.proposal;
  const run = resolved.run;
  if (!proposal || !run) throw new Error('draft proposal が見つかりません');
  if (!validateProposalSchema(proposal)) throw new Error('draft schema が不正です');
  if (!proposal.compliance.allowed) {
    const err: any = new Error('ComplianceGuardでcritical riskがあるため承認不可');
    err.risk_flags = proposal.risk_flags;
    throw err;
  }
  const queueItem = enqueuePost({
    type: 'fanza',
    text: proposal.draft_text,
    affiliateUrl: proposal.work?.affiliate_url,
    itemTitle: proposal.work?.title,
    templateType: 'agent-proposal',
    templateCategory: 'review',
    agentRunId: run.run_id,
    agentProposalId: proposal.id,
    expectedEffect: proposal.expected_effect,
    safetyScore: Math.max(0, 100 - proposal.risk_flags.length * 12),
    filterResult: {
      safe: proposal.compliance.allowed,
      reason: proposal.risk_flags[0]?.message,
    },
    mediaFiles: proposal.attached_media.sample_url
      ? [{ filename: proposal.attached_media.sample_url.split('/').pop() ?? 'agent-media', url: proposal.attached_media.sample_url, type: proposal.attached_media.format }]
      : undefined,
  });
  await recordProposalFeedback({
    run_id: run.run_id,
    proposal_id: proposal.id,
    decision: 'queued',
    reason,
    queue_item_id: queueItem.id,
  });
  return { draft_id: queueItem.id, proposal, run, queueItem };
}

export async function approveDraft(draftId: string, reason?: string): Promise<DraftResolution> {
  const resolved = await materializeDraft(draftId, reason);
  const item = approveQueueItem(resolved.queueItem!.id, reason);
  if (!item) throw new Error('draft 承認に失敗しました');
  return { ...resolved, draft_id: item.id, queueItem: item };
}

export async function rejectDraft(draftId: string, reason?: string): Promise<DraftResolution> {
  const resolved = await materializeDraft(draftId, reason);
  const item = rejectQueueItem(resolved.queueItem!.id, reason);
  if (!item) throw new Error('draft 却下に失敗しました');
  return { ...resolved, draft_id: item.id, queueItem: item };
}

export async function scheduleDraft(draftId: string, scheduledFor: string, reason?: string): Promise<DraftResolution> {
  if (!scheduledFor || Number.isNaN(new Date(scheduledFor).getTime())) throw new Error('scheduled_for は有効な日時で指定してください');
  const resolved = await materializeDraft(draftId, reason);
  const item = scheduleQueueItem(resolved.queueItem!.id, new Date(scheduledFor).toISOString(), reason);
  if (!item) throw new Error('draft 予約に失敗しました');
  return { ...resolved, draft_id: item.id, queueItem: item };
}
