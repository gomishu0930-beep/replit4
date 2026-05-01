import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../fanza-bot/data');
const VIDEO_DIR = path.join(DATA_DIR, 'sample-videos');

function getMediaBaseUrl(): string {
  const domain =
    process.env.REPLIT_DEV_DOMAIN ??
    process.env.REPLIT_DEPLOYMENT_DOMAIN ??
    (process.env.REPLIT_DOMAINS ?? '').split(',')[0].trim();
  if (domain) return `https://${domain}/api/bot/media`;
  return '/api/bot/media';
}

function mediaUrl(filename: string): string {
  return `${getMediaBaseUrl()}/${encodeURIComponent(filename)}`;
}

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
  method: 'direct' | 'slideshow';
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

async function downloadImageToTemp(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FanzaBot/1.0)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`画像取得失敗 (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(destPath, buf);
}

export async function prepareSampleVideoClip(
  item: any,
  opts: { startSec?: number; durationSec?: number } = {},
): Promise<PreparedSampleVideo> {
  const permission = checkSampleVideoPermission(item);
  if (!permission.allowed) throw new Error(`サンプル動画利用不可: ${permission.reason}`);
  if (!(await hasFfmpeg())) throw new Error('ffmpeg が利用できません');

  await fsp.mkdir(VIDEO_DIR, { recursive: true });
  const durationSec = Math.min(Math.max(Number(opts.durationSec ?? 8), 4), 15);
  const contentId = item?.content_id ?? item?.id ?? Date.now().toString();
  const filename = `${safeFilename(contentId)}-${Date.now()}.mp4`;
  const filePath = path.join(VIDEO_DIR, filename);

  const sourceUrl = extractSampleMovieUrl(item);
  if (sourceUrl) {
    try {
      const startSec = Math.min(Math.max(Number(opts.startSec ?? 3), 0), 120);
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
      const stat = await fsp.stat(filePath);
      if (stat.size > 1024) {
        return { filename, filePath, url: mediaUrl(filename), sourceUrl, durationSec, method: 'direct' };
      }
    } catch {
    }
  }

  return createSlideshowVideo(item, { durationSec, filename, filePath });
}

export async function createSlideshowVideo(
  item: any,
  opts: { durationSec?: number; filename?: string; filePath?: string } = {},
): Promise<PreparedSampleVideo> {
  if (!(await hasFfmpeg())) throw new Error('ffmpeg が利用できません');

  const permission = checkSampleVideoPermission(item);
  if (!permission.allowed) throw new Error(`サンプル動画利用不可: ${permission.reason}`);

  await fsp.mkdir(VIDEO_DIR, { recursive: true });

  const durationSec = Math.min(Math.max(Number(opts.durationSec ?? 8), 4), 15);
  const contentId = item?.content_id ?? item?.id ?? Date.now().toString();
  const filename = opts.filename ?? `${safeFilename(contentId)}-slide-${Date.now()}.mp4`;
  const filePath = opts.filePath ?? path.join(VIDEO_DIR, filename);

  const imageUrls = extractSampleImageUrls(item);
  if (imageUrls.length === 0) {
    throw new Error('スライドショー用のサンプル画像URLが見つかりません');
  }

  const maxImages = Math.min(imageUrls.length, 6);
  const perImageSec = durationSec / maxImages;

  const tmpDir = path.join(VIDEO_DIR, `tmp-${Date.now()}`);
  await fsp.mkdir(tmpDir, { recursive: true });

  try {
    const downloadedPaths: string[] = [];
    for (let i = 0; i < maxImages; i++) {
      const tmpPath = path.join(tmpDir, `img${i}.jpg`);
      await downloadImageToTemp(imageUrls[i], tmpPath);
      downloadedPaths.push(tmpPath);
    }

    const ffArgs: string[] = ['-y'];
    for (const imgPath of downloadedPaths) {
      ffArgs.push('-loop', '1', '-t', String(perImageSec), '-i', imgPath);
    }

    const n = downloadedPaths.length;
    const filterParts: string[] = [];
    for (let i = 0; i < n; i++) {
      filterParts.push(
        `[${i}:v]scale=720:480:force_original_aspect_ratio=decrease,` +
        `pad=720:480:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24[v${i}]`,
      );
    }
    const concatInputs = Array.from({ length: n }, (_, i) => `[v${i}]`).join('');
    filterParts.push(`${concatInputs}concat=n=${n}:v=1:a=0[outv]`);

    ffArgs.push(
      '-filter_complex', filterParts.join(';'),
      '-map', '[outv]',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      filePath,
    );

    await runFfmpeg(ffArgs);
  } finally {
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  return {
    filename,
    filePath,
    url: mediaUrl(filename),
    sourceUrl: imageUrls[0],
    durationSec,
    method: 'slideshow',
  };
}

export function extractSampleImageUrls(item: any): string[] {
  const rawSamples =
    item?.sampleImageURL?.sample_l?.image ??
    item?.sampleImageURL?.sample_s?.image ??
    item?.sampleImages ??
    [];
  const samples = Array.isArray(rawSamples) ? rawSamples : [rawSamples];
  const fallback = [item?.imageURL?.large, item?.imageURL?.small, item?.thumbnail].filter(Boolean);
  return [...new Set([...samples, ...fallback])]
    .filter((url): url is string => typeof url === 'string' && /^https?:\/\//.test(url))
    .slice(0, 8);
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
