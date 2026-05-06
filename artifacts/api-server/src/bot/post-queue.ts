/**
 * 投稿キューモジュール
 * スケジューラーが生成した投稿候補を即座に送信せずキューに積み、
 * AUTO_POST_ENABLED=true の場合に自動承認、false の場合は手動承認待ちにする。
 * DRY_RUN=true の場合は実際の投稿を行わずログのみ出力する。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { isAutoPostEnabled, isDryRun } from './run-config.js';
import type { TemplateCategory } from './fanza-templates.js';
import { recordProposalFeedback } from './agent-learning-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../fanza-bot/data');
const QUEUE_FILE = path.join(DATA_DIR, 'post-queue.json');

export type QueueItemStatus = 'pending' | 'approved' | 'rejected' | 'posted' | 'failed' | 'dry_run';
export type QueueItemType = 'fanza' | 'engagement' | 'erotic-story' | 'myfans' | 'emergency';

export interface QueueItem {
  id: string;
  type: QueueItemType;
  text: string;
  imagePrompt?: string;
  imageUrl?: string;
  affiliateUrl?: string;
  itemTitle?: string;
  provider?: string;
  sourceUrl?: string;
  templateType?: string;
  templateCategory?: TemplateCategory | 'engagement' | 'erotic-story' | 'other';
  agentRunId?: string;
  agentProposalId?: string;
  expectedEffect?: string;
  approvalReason?: string;
  rejectionReason?: string;
  safetyScore?: number;
  mediaFiles?: Array<{ filename: string; url?: string; type: string }>;
  status: QueueItemStatus;
  filterResult?: { safe: boolean; reason?: string };
  tweetId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  scheduledFor?: string;
  postedAt?: string;
}

let queue: QueueItem[] = [];
let queueNotifier: ((item: QueueItem) => void) | null = null;

export function setQueueNotifier(fn: (item: QueueItem) => void): void {
  queueNotifier = fn;
}

function save(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
  } catch (e) {
    console.error('[Queue] 保存失敗:', e);
  }
}

export function loadQueue(): void {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const raw = fs.readFileSync(QUEUE_FILE, 'utf-8');
      queue = JSON.parse(raw) as QueueItem[];
      const staleIds = queue
        .filter(i => i.status === 'pending' && Date.now() - new Date(i.createdAt).getTime() > 24 * 3600000)
        .map(i => i.id);
      if (staleIds.length > 0) {
        staleIds.forEach(id => {
          const item = queue.find(q => q.id === id);
          if (item) { item.status = 'rejected'; item.updatedAt = new Date().toISOString(); }
        });
        save();
        console.log(`  🗑 [Queue] 24時間超えの古いキュー ${staleIds.length}件を自動却下`);
      }
    }
  } catch {
    queue = [];
  }
}

export function enqueuePost(draft: Omit<QueueItem, 'id' | 'status' | 'createdAt' | 'updatedAt'>): QueueItem {
  const now = new Date().toISOString();
  const item: QueueItem = {
    ...draft,
    id: randomUUID(),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  queue.push(item);
  if (queue.length > 200) queue = queue.slice(-200);
  save();
  console.log(`  📬 [Queue] キュー追加: id=${item.id} type=${item.type} autoPost=${isAutoPostEnabled()} dryRun=${isDryRun()}`);
  if (queueNotifier) {
    try { queueNotifier(item); } catch { /* ignore */ }
  }
  return item;
}

export function getQueue(statusFilter?: QueueItemStatus[]): QueueItem[] {
  if (!statusFilter) return [...queue];
  return queue.filter(i => statusFilter.includes(i.status));
}

export function getPendingQueue(): QueueItem[] {
  return queue.filter(i => i.status === 'pending');
}

export function getQueueItem(id: string): QueueItem | undefined {
  return queue.find(i => i.id === id);
}

export function approveQueueItem(id: string, reason?: string): QueueItem | null {
  const item = queue.find(i => i.id === id);
  if (!item) return null;
  if (item.status !== 'pending') return item;
  item.status = 'approved';
  item.approvalReason = reason;
  item.updatedAt = new Date().toISOString();
  save();
  if (item.agentRunId && item.agentProposalId) {
    recordProposalFeedback({
      run_id: item.agentRunId,
      proposal_id: item.agentProposalId,
      decision: 'approved',
      reason,
      queue_item_id: item.id,
    }).catch(() => {});
  }
  console.log(`  ✅ [Queue] 承認: id=${id}`);
  return item;
}

export function rejectQueueItem(id: string, reason?: string): QueueItem | null {
  const item = queue.find(i => i.id === id);
  if (!item) return null;
  item.status = 'rejected';
  item.rejectionReason = reason;
  item.updatedAt = new Date().toISOString();
  save();
  if (item.agentRunId && item.agentProposalId) {
    recordProposalFeedback({
      run_id: item.agentRunId,
      proposal_id: item.agentProposalId,
      decision: 'rejected',
      reason,
      queue_item_id: item.id,
    }).catch(() => {});
  }
  console.log(`  ❌ [Queue] 却下: id=${id}`);
  return item;
}

export function scheduleQueueItem(id: string, scheduledFor: string, reason?: string): QueueItem | null {
  const item = queue.find(i => i.id === id);
  if (!item) return null;
  if (item.status === 'rejected' || item.status === 'posted' || item.status === 'failed' || item.status === 'dry_run') return item;
  item.status = 'approved';
  item.scheduledFor = scheduledFor;
  item.approvalReason = reason;
  item.updatedAt = new Date().toISOString();
  save();
  if (item.agentRunId && item.agentProposalId) {
    recordProposalFeedback({
      run_id: item.agentRunId,
      proposal_id: item.agentProposalId,
      decision: 'approved',
      reason: reason ? `scheduled: ${reason}` : `scheduled: ${scheduledFor}`,
      queue_item_id: item.id,
    }).catch(() => {});
  }
  console.log(`  🗓 [Queue] 予約承認: id=${id} scheduledFor=${scheduledFor}`);
  return item;
}

export function markPosted(id: string, tweetId: string, status?: 'posted' | 'dry_run'): void {
  const item = queue.find(i => i.id === id);
  if (!item) return;
  item.status = status ?? (isDryRun() ? 'dry_run' : 'posted');
  item.tweetId = tweetId;
  item.postedAt = new Date().toISOString();
  item.updatedAt = new Date().toISOString();
  save();
  if (item.agentRunId && item.agentProposalId) {
    recordProposalFeedback({
      run_id: item.agentRunId,
      proposal_id: item.agentProposalId,
      decision: status === 'dry_run' ? 'queued' : 'posted',
      reason: status === 'dry_run' ? 'dry_run' : undefined,
      queue_item_id: item.id,
    }).catch(() => {});
  }
}

export function markFailed(id: string, error: string): void {
  const item = queue.find(i => i.id === id);
  if (!item) return;
  item.status = 'failed';
  item.error = error;
  item.updatedAt = new Date().toISOString();
  save();
  if (item.agentRunId && item.agentProposalId) {
    recordProposalFeedback({
      run_id: item.agentRunId,
      proposal_id: item.agentProposalId,
      decision: 'failed',
      reason: error,
      queue_item_id: item.id,
    }).catch(() => {});
  }
  console.error(`  ❌ [Queue] 投稿失敗: id=${id} error=${error}`);
}

export function getQueueStats() {
  const counts: Record<QueueItemStatus, number> = {
    pending: 0, approved: 0, rejected: 0, posted: 0, failed: 0, dry_run: 0,
  };
  for (const item of queue) counts[item.status]++;
  return { total: queue.length, ...counts };
}
