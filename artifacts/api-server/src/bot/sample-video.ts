import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../fanza-bot/data');
const VIDEO_DIR = path.join(DATA_DIR, 'sample-videos');

export interface SampleVideoPermission {
  allowed: boolean;
  reason: string;
  makers: string[];
  allowedMakers: string[];
}

export interface PreparedSampleVideo {
  filename: string;
  filePath: string;
  url: string;
  sourceUrl: string;
  durationSec: number;
}

function walkStrings(value: any, out: string[]): void {
  if (!value) return;
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v) => walkStrings(v, out));
    return;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((v) => walkStrings(v, out));
  }
}

export function extractSampleMovieUrl(item: any): string | null {
  const candidates: string[] = [];
  walkStrings(item?.sampleMovieURL ?? item?.sampleMovieUrl ?? item?.sample_movie_url, candidates);
  if (candidates.length === 0) walkStrings(item, candidates);

  const urls = candidates
    .filter((v) => /^https?:\/\//.test(v))
    .filter((v) => /movie|sample|\.mp4|\.m3u8|smovie/i.test(v));

  return urls.find((v) => /720|high|large|mp4/i.test(v)) ?? urls[0] ?? null;
}

export function getFanzaMakerNames(item: any): string[] {
  const values = [
    item?.maker,
    item?.makers,
    item?.iteminfo?.maker,
    item?.iteminfo?.label,
    item?.label,
  ];
  const names: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (typeof value === 'string') names.push(value);
    else if (Array.isArray(value)) {
      for (const v of value) {
        const name = typeof v === 'string' ? v : v?.name;
        if (name) names.push(name);
      }
    } else if (typeof value === 'object' && value.name) {
      names.push(value.name);
    }
  }
  return [...new Set(names.filter(Boolean))];
}

function getAllowedMakers(): string[] {
  return (process.env.FANZA_SAMPLE_VIDEO_ALLOWED_MAKERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function checkSampleVideoPermission(item: any): SampleVideoPermission {
  const makers = getFanzaMakerNames(item);
  const allowedMakers = getAllowedMakers();
  if (allowedMakers.length === 0) {
    return { allowed: false, reason: '許可メーカー未設定', makers, allowedMakers };
  }
  if (allowedMakers.includes('*')) {
    return { allowed: true, reason: '全メーカー許可モード', makers, allowedMakers };
  }
  const allowed = makers.some((maker) =>
    allowedMakers.some((allowedMaker) => maker === allowedMaker || maker.includes(allowedMaker) || allowedMaker.includes(maker)),
  );
  return {
    allowed,
    reason: allowed ? '許可メーカー一致' : '許可メーカー対象外',
    makers,
    allowedMakers,
  };
}

export async function hasFfmpeg(): Promise<boolean> {
  const command = process.env.FFMPEG_PATH ?? 'ffmpeg';
  return new Promise((resolve) => {
    const child = spawn(command, ['-version']);
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

function safeFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'sample';
}

function runFfmpeg(args: string[]): Promise<void> {
  const command = process.env.FFMPEG_PATH ?? 'ffmpeg';
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (chunk) => { err += String(chunk).slice(-2000); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${err.slice(-500)}`));
    });
  });
}

export async function prepareSampleVideoClip(
  item: any,
  opts: { startSec?: number; durationSec?: number } = {},
): Promise<PreparedSampleVideo> {
  const sourceUrl = extractSampleMovieUrl(item);
  if (!sourceUrl) throw new Error('サンプル動画URLが見つかりません');

  const permission = checkSampleVideoPermission(item);
  if (!permission.allowed) throw new Error(`サンプル動画利用不可: ${permission.reason}`);
  if (!(await hasFfmpeg())) throw new Error('ffmpeg が利用できません。Replitのnix packagesに ffmpeg を追加してください');

  await fsp.mkdir(VIDEO_DIR, { recursive: true });
  const durationSec = Math.min(Math.max(Number(opts.durationSec ?? 8), 4), 15);
  const startSec = Math.min(Math.max(Number(opts.startSec ?? 3), 0), 120);
  const filename = `${safeFilename(item?.content_id ?? item?.id ?? Date.now().toString())}-${Date.now()}.mp4`;
  const filePath = path.join(VIDEO_DIR, filename);

  await runFfmpeg([
    '-y',
    '-ss', String(startSec),
    '-user_agent', 'FanzaBot/1.0',
    '-i', sourceUrl,
    '-t', String(durationSec),
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-movflags', '+faststart',
    '-pix_fmt', 'yuv420p',
    filePath,
  ]);

  return { filename, filePath, url: `/api/bot/media/${encodeURIComponent(filename)}`, sourceUrl, durationSec };
}

export function getSampleVideoFilePath(filename: string): string | null {
  const safe = path.basename(filename);
  const filePath = path.join(VIDEO_DIR, safe);
  return fs.existsSync(filePath) ? filePath : null;
}

export async function getSampleVideoStatus() {
  return {
    ffmpegAvailable: await hasFfmpeg(),
    allowedMakers: getAllowedMakers(),
    videoDir: VIDEO_DIR,
  };
}
