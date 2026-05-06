import { randomUUID } from 'crypto';
import { readJson, writeJson } from './cloudStore.js';
import type { AgentRun, AgentRunInput, AgentRunKind, AgentRunStatus, RiskFlag } from './agent-types.js';

interface AgentRunData {
  runs: AgentRun[];
}

let cache: AgentRunData = { runs: [] };
let loaded = false;
const KEY = 'agent-runs.json';

export async function loadAgentRuns(): Promise<void> {
  if (loaded) return;
  cache = await readJson<AgentRunData>(KEY, { runs: [] });
  loaded = true;
}

async function save(): Promise<void> {
  cache.runs = cache.runs.slice(0, 100);
  await writeJson(KEY, cache);
}

export async function startAgentRun(
  kind: AgentRunKind,
  input: AgentRunInput,
  source: AgentRun['source'] = 'api',
): Promise<AgentRun> {
  await loadAgentRuns();
  const run: AgentRun = {
    run_id: randomUUID(),
    kind,
    status: 'running',
    source,
    input,
    started_at: new Date().toISOString(),
    cost_estimate: 0,
    data_count: 0,
    risk_flags: [],
  };
  cache.runs.unshift(run);
  await save();
  return run;
}

export async function finishAgentRun(
  runId: string,
  patch: Partial<Pick<AgentRun, 'output' | 'error' | 'cost_estimate' | 'data_count' | 'risk_flags'>>,
  status: AgentRunStatus,
): Promise<AgentRun | null> {
  await loadAgentRuns();
  const run = cache.runs.find((r) => r.run_id === runId);
  if (!run) return null;
  Object.assign(run, patch, {
    status,
    finished_at: new Date().toISOString(),
  });
  await save();
  return run;
}

export async function appendRunRisk(runId: string, risk: RiskFlag): Promise<void> {
  await loadAgentRuns();
  const run = cache.runs.find((r) => r.run_id === runId);
  if (!run) return;
  run.risk_flags.push(risk);
  await save();
}

export async function getAgentRun(runId: string): Promise<AgentRun | null> {
  await loadAgentRuns();
  return cache.runs.find((r) => r.run_id === runId) ?? null;
}

export async function getAgentRuns(limit = 20): Promise<AgentRun[]> {
  await loadAgentRuns();
  return cache.runs.slice(0, limit);
}
