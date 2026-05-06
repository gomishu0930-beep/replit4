import { Router } from 'express';
import { getAgentRun, getAgentRuns, normalizeAgentInput, runMarketAnalysis } from '../bot/agent-service.js';
import { getAnalyticsStats } from '../bot/post-analytics.js';
import { getQueue, getQueueStats } from '../bot/post-queue.js';
import {
  approveDraft,
  createDraftRunFromRequest,
  materializeDraft,
  rejectDraft,
  scheduleDraft,
} from '../bot/draft-service.js';

const router = Router();

function sourceFromBody(value: any) {
  return value === 'discord' ? 'discord' : value === 'ui' ? 'ui' : value === 'test' ? 'test' : 'api';
}

function summarizeRun(run: Awaited<ReturnType<typeof getAgentRun>> extends infer T ? NonNullable<T> : never) {
  return {
    ...run,
    output: run.output ? {
      marketCount: run.output.marketPosts.length,
      ownCount: run.output.ownPosts.length,
      proposalCount: run.output.proposals.length,
      topMarketPosts: run.output.marketPosts.slice(0, 5),
      winningPatterns: run.output.comparison.winningPatterns,
      ownAccountGaps: run.output.comparison.ownAccountGaps,
      recommendedWorks: run.output.recommendedWorks,
      comparison: run.output.comparison,
      proposals: run.output.proposals,
      mediaRecommendations: run.output.mediaRecommendations,
      scheduleRecommendations: run.output.scheduleRecommendations,
      learningSignals: run.output.learningSignals,
      recommendationSchema: run.output.recommendationSchema,
      diagnostics: run.output.diagnostics,
    } : undefined,
  };
}

function runEvents(run: NonNullable<Awaited<ReturnType<typeof getAgentRun>>>) {
  const output = run.output;
  return [
    { type: 'run_started', at: run.started_at, message: `${run.kind} started`, status: run.status },
    ...(output ? [
      { type: 'market_collected', at: run.finished_at ?? run.started_at, message: `market posts=${output.marketPosts.length}`, data_count: output.marketPosts.length },
      { type: 'own_compared', at: run.finished_at ?? run.started_at, message: `own posts=${output.ownPosts.length}`, data_count: output.ownPosts.length },
      { type: 'works_scored', at: run.finished_at ?? run.started_at, message: `recommended works=${output.recommendedWorks.length}`, data_count: output.recommendedWorks.length },
      { type: 'drafts_generated', at: run.finished_at ?? run.started_at, message: `drafts=${output.proposals.length}`, data_count: output.proposals.length },
      ...run.risk_flags.map((risk) => ({ type: 'risk_flag', at: run.finished_at ?? run.started_at, message: risk.message, risk })),
    ] : []),
    ...(run.finished_at ? [{ type: 'run_finished', at: run.finished_at, message: `${run.kind} ${run.status}`, status: run.status }] : []),
  ];
}

async function executeRun(req: any, res: any, kind: 'market_scan' | 'compare_own' | 'work_analysis') {
  const input = normalizeAgentInput({
    ...(req.body ?? {}),
    ...(kind === 'compare_own' ? { maxResults: Math.min(Number(req.body?.maxResults ?? req.body?.count ?? 100), 500) } : {}),
  });
  const run = await runMarketAnalysis(input, sourceFromBody(req.body?.source), kind);
  res.status(run.status === 'failed' ? 500 : 200).json({ ok: run.status !== 'failed', run });
}

router.get('/agent/runs', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 100);
  const runs = await getAgentRuns(limit);
  res.json({ ok: true, runs: runs.map(summarizeRun) });
});

router.post('/agent/runs/market-scan', (req, res) => executeRun(req, res, 'market_scan'));
router.post('/agent/runs/compare-own', (req, res) => executeRun(req, res, 'compare_own'));
router.post('/agent/runs/work-analysis', (req, res) => executeRun(req, res, 'work_analysis'));

router.get('/agent/runs/:id', async (req, res) => {
  const run = await getAgentRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'agent run が見つかりません' });
    return;
  }
  res.json({ ok: true, run });
});

router.get('/agent/runs/:id/events', async (req, res) => {
  const run = await getAgentRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'agent run が見つかりません' });
    return;
  }
  res.json({ ok: true, run_id: run.run_id, events: runEvents(run) });
});

router.post('/drafts', async (req, res) => {
  const run = await createDraftRunFromRequest(req.body ?? {});
  res.status(run.status === 'failed' ? 500 : 200).json({
    ok: run.status !== 'failed',
    run_id: run.run_id,
    drafts: run.output?.proposals ?? [],
    run,
  });
});

router.post('/drafts/:id/approve', async (req, res) => {
  try {
    const result = await approveDraft(req.params.id, typeof req.body?.reason === 'string' ? req.body.reason : undefined);
    res.json({ ok: true, draft_id: result.draft_id, queueItem: result.queueItem, proposal: result.proposal, run_id: result.run?.run_id });
  } catch (e: any) {
    res.status(400).json({ error: e.message ?? String(e), risk_flags: e.risk_flags });
  }
});

router.post('/drafts/:id/reject', async (req, res) => {
  try {
    const result = await rejectDraft(req.params.id, typeof req.body?.reason === 'string' ? req.body.reason : undefined);
    res.json({ ok: true, draft_id: result.draft_id, queueItem: result.queueItem, proposal: result.proposal, run_id: result.run?.run_id });
  } catch (e: any) {
    res.status(400).json({ error: e.message ?? String(e), risk_flags: e.risk_flags });
  }
});

router.post('/drafts/:id/schedule', async (req, res) => {
  try {
    const result = await scheduleDraft(
      req.params.id,
      String(req.body?.scheduled_for ?? req.body?.scheduledFor ?? ''),
      typeof req.body?.reason === 'string' ? req.body.reason : undefined,
    );
    res.json({ ok: true, draft_id: result.draft_id, queueItem: result.queueItem, proposal: result.proposal, run_id: result.run?.run_id });
  } catch (e: any) {
    res.status(400).json({ error: e.message ?? String(e), risk_flags: e.risk_flags });
  }
});

router.get('/reports/daily', async (_req, res) => {
  const runs = await getAgentRuns(10);
  const latest = runs[0] ?? null;
  res.json({
    ok: true,
    date: new Date().toISOString().slice(0, 10),
    latest_run_id: latest?.run_id ?? null,
    analytics: getAnalyticsStats(1),
    queue: getQueueStats(),
    pending_drafts: getQueue(['pending', 'approved']).filter((item) => item.agentRunId || item.templateType === 'agent-proposal').slice(0, 20),
    risk_flags: latest?.risk_flags ?? [],
    summary: latest?.output?.recommendationSchema?.summary ?? 'Agent Runはまだありません',
  });
});

// Backward-compatible aliases used by the existing UI and older Discord commands.
router.post('/agent/market-scan', (req, res) => executeRun(req, res, 'market_scan'));
router.post('/agent/compare-own', (req, res) => executeRun(req, res, 'compare_own'));
router.post('/agent/draft', async (req, res) => {
  const run = await createDraftRunFromRequest(req.body ?? {});
  res.status(run.status === 'failed' ? 500 : 200).json({ ok: run.status !== 'failed', run_id: run.run_id, proposals: run.output?.proposals ?? [], run });
});
router.get('/agent/report/:id', async (req, res) => {
  const run = await getAgentRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'agent run が見つかりません' });
    return;
  }
  res.json({ ok: true, run_id: run.run_id, status: run.status, summary: run.output?.recommendationSchema ?? null, risk_flags: run.risk_flags });
});
router.post('/agent/runs/:id/proposals/:proposalId/queue', async (req, res) => {
  try {
    const result = await materializeDraft(req.params.proposalId, typeof req.body?.reason === 'string' ? req.body.reason : undefined);
    res.json({ ok: true, queueItem: result.queueItem, proposal: result.proposal, run_id: result.run?.run_id });
  } catch (e: any) {
    res.status(400).json({ error: e.message ?? String(e), risk_flags: e.risk_flags });
  }
});
router.post('/agent/runs/:id/proposals/:proposalId/feedback', async (req, res) => {
  try {
    const decision = String(req.body?.decision ?? '');
    if (decision === 'rejected') {
      const result = await rejectDraft(req.params.proposalId, typeof req.body?.reason === 'string' ? req.body.reason : undefined);
      res.json({ ok: true, result });
      return;
    }
    const result = await materializeDraft(req.params.proposalId, typeof req.body?.reason === 'string' ? req.body.reason : undefined);
    res.json({ ok: true, result });
  } catch (e: any) {
    res.status(400).json({ error: e.message ?? String(e), risk_flags: e.risk_flags });
  }
});

export default router;
