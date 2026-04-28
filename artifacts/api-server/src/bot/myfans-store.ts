/**
 * myfans-store.ts — MyFans アフィリエイトアイテムの永続ストレージ
 * GCS / ローカルファイルの二重保存（cloudStore.ts と同パターン）
 */
import { readJson, writeJson } from './cloudStore.js';
import { randomUUID } from 'crypto';

// ─── 型定義 ───────────────────────────────────────────────────────────────────

export type MyFansStatus = 'draft' | 'reviewed' | 'approved' | 'rejected' | 'posted';
export type MediaType = 'official_preview' | 'thumbnail' | 'user_owned';

export interface MyFansMedia {
  filename: string;
  url?: string;
  type: MediaType;
  mimeType?: string;
  sizeBytes?: number;
}

export interface MyFansItem {
  id: string;
  provider: 'myfans';
  creator_name: string;
  source_url: string;
  affiliate_url: string;
  original_text: string;
  generated_caption: string;
  media_files: MyFansMedia[];
  status: MyFansStatus;
  safety_notes: string[];
  queue_id?: string;
  created_at: string;
  updated_at: string;
}

interface MyFansData {
  items: MyFansItem[];
  fetch_jobs: FetchJob[];
}

export interface FetchJob {
  id: string;
  created_at: string;
  instructions: string;
  target_count: number;
  status: 'pending' | 'in_progress' | 'done';
}

// ─── インメモリキャッシュ ─────────────────────────────────────────────────────

let cache: MyFansData = { items: [], fetch_jobs: [] };
let myfansInitialized = false;

// ─── 初期化 ───────────────────────────────────────────────────────────────────

export async function initMyfansStore(): Promise<void> {
  if (myfansInitialized) return;
  cache = await readJson<MyFansData>('myfans-items.json', { items: [], fetch_jobs: [] });
  if (!cache.fetch_jobs) cache.fetch_jobs = [];
  myfansInitialized = true;
  console.log(`  ✅ MyFansストア初期化 (${cache.items.length}件 / ジョブ: ${cache.fetch_jobs.length}件)`);
}

function saveAsync(): void {
  writeJson('myfans-items.json', cache).catch((e: any) =>
    console.warn('  ⚠ myfans-items.json 保存失敗:', e.message),
  );
}

// ─── Items CRUD ───────────────────────────────────────────────────────────────

export function getMyfansItems(status?: MyFansStatus): MyFansItem[] {
  if (status) return cache.items.filter(i => i.status === status);
  return cache.items;
}

export function getMyfansItem(id: string): MyFansItem | undefined {
  return cache.items.find(i => i.id === id);
}

export function isDuplicate(source_url: string, affiliate_url: string): boolean {
  return cache.items.some(
    i =>
      (source_url && i.source_url === source_url) ||
      (affiliate_url && i.affiliate_url === affiliate_url),
  );
}

export function addMyfansItem(
  data: Omit<MyFansItem, 'id' | 'created_at' | 'updated_at'>,
): MyFansItem {
  const item: MyFansItem = {
    ...data,
    id: randomUUID(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  cache.items.unshift(item);
  saveAsync();
  return item;
}

export function updateMyfansItem(
  id: string,
  patch: Partial<Omit<MyFansItem, 'id' | 'created_at'>>,
): MyFansItem | null {
  const idx = cache.items.findIndex(i => i.id === id);
  if (idx === -1) return null;
  cache.items[idx] = {
    ...cache.items[idx],
    ...patch,
    updated_at: new Date().toISOString(),
  };
  saveAsync();
  return cache.items[idx];
}

export function deleteMyfansItem(id: string): boolean {
  const before = cache.items.length;
  cache.items = cache.items.filter(i => i.id !== id);
  if (cache.items.length !== before) {
    saveAsync();
    return true;
  }
  return false;
}

// ─── FetchJobs ────────────────────────────────────────────────────────────────

export function createFetchJob(target_count = 5): FetchJob {
  const job: FetchJob = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    status: 'pending',
    target_count,
    instructions: [
      `MyFans クリエイターページを開き、以下の情報を取得してください（${target_count}件）:`,
      '- creator_name: クリエイター名',
      '- source_url: クリエイターページのURL',
      '- affiliate_url: MyFansアフィリエイトリンク (必須)',
      '- original_text: 投稿文テキスト',
      '- media_files: official_preview または thumbnail のみ (有料限定コンテンツは除外)',
      '',
      '取得後は POST /api/myfans/ingest にJSON形式で送信してください。',
      'Authorization: Bearer <MYFANS_INGEST_SECRET>',
    ].join('\n'),
  };
  cache.fetch_jobs.unshift(job);
  saveAsync();
  return job;
}

export function getFetchJobs(): FetchJob[] {
  return cache.fetch_jobs;
}

export function updateFetchJobStatus(id: string, status: FetchJob['status']): void {
  const job = cache.fetch_jobs.find(j => j.id === id);
  if (job) {
    job.status = status;
    saveAsync();
  }
}
