import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { Storage } from '@google-cloud/storage';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../fanza-bot/data');
const VIDEO_DIR = path.join(DATA_DIR, 'sample-videos');

const REPLIT_SIDECAR = 'http://127.0.0.1:1106';
const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID ?? '';

function createGcsClient(): Storage | null {
  if (!BUCKET_ID) return null;
  try {
    return new Storage({
      credentials: {
        audience: 'replit',
        subject_token_type: 'access_token',
        token_url: `${REPLIT_SIDECAR}/token`,
        type: 'external_account',
        credential_source: {
          url: `${REPLIT_SIDECAR}/credential`,
          format: { type: 'json', subject_token_field_name: 'access_token' },
        },
        universe_domain: 'googleapis.com',
      } as any,
      projectId: '',
    });
  } catch {
    return null;
  }
}

const gcs = createGcsClient();

async function uploadVideoToGcs(filePath: string, filename: string): Promise<void> {
  if (!gcs || !BUCKET_ID) return;
  try {
    const gcsPath = `fanza-bot/sample-videos/${filename}`;
    const file = gcs.bucket(BUCKET_ID).file(gcsPath);
    await file.save(await fsp.readFile(filePath), {
      contentType: 'video/mp4',
      resumable: false,
    });
  } catch {
    // バックグラウンドバックアップ失敗は無視
  }
}

function getFallbackMediaUrl(filename: string): string {
  const domain =
    process.env.REPLIT_DEV_DOMAIN ??
    process.env.REPLIT_DEPLOYMENT_DOMAIN ??
    (process.env.REPLIT_DOMAINS ?? '').split(',')[0].trim();
  const base = domain ? `https://${domain}/api/bot/media` : '/api/bot/media';
  return `${base}/${encodeURIComponent(filename)}`;
}

async function mediaUrl(filename: string, filePath: string): Promise<string> {
  // GCSへのバックアップは非同期でバックグラウンド実行（URLには使わない）
  uploadVideoToGcs(filePath, filename).catch(() => {});
  return getFallbackMediaUrl(filename);
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
        return { filename, filePath, url: await mediaUrl(filename, filePath), sourceUrl, durationSec, method: 'direct' };
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

    const fps = 24;
    // fadeduration: 各画像間のフェードアウト秒数
    const fadeSec = Math.min(0.5, perImageSec * 0.25);

    const ffArgs: string[] = ['-y'];
    for (const imgPath of downloadedPaths) {
      // 長めに読み込む（xfadeのoverlapのため）
      ffArgs.push('-loop', '1', '-t', String(perImageSec + fadeSec), '-i', imgPath);
    }

    const n = downloadedPaths.length;
    const filterParts: string[] = [];

    // 各画像をスケール＋クロップアニメーション（CPU負荷小さい）
    for (let i = 0; i < n; i++) {
      // 偶数: 左→右パン, 奇数: 右→左パン（1.2倍スケールからクロップ）
      const cropX = i % 2 === 0
        ? `'min(iw-720,iw*0.1*t/${perImageSec})'`
        : `'max(0,iw*0.1*(1-t/${perImageSec}))'`;
      filterParts.push(
        `[${i}:v]scale=864:576:force_original_aspect_ratio=increase,` +
        `crop=720:480:${cropX}:48,setsar=1,fps=${fps}[v${i}]`,
      );
    }

    // xfadeでクロスフェードトランジションを連鎖
    if (n === 1) {
      filterParts.push(`[v0]copy[outv]`);
    } else {
      const transitions = ['fade', 'slideup', 'slideleft', 'dissolve', 'wipeleft', 'wipeup'];
      let prev = 'v0';
      for (let i = 1; i < n; i++) {
        const offset = (perImageSec * i) - fadeSec * i;
        const tr = transitions[(i - 1) % transitions.length];
        const out = i === n - 1 ? 'outv' : `xf${i}`;
        filterParts.push(
          `[${prev}][v${i}]xfade=transition=${tr}:duration=${fadeSec}:offset=${offset.toFixed(2)}[${out}]`,
        );
        prev = out;
      }
    }

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
    url: await mediaUrl(filename, filePath),
    sourceUrl: imageUrls[0],
    durationSec,
    method: 'slideshow',
  };
}

export interface ClipMp4Result {
  filename: string;
  filePath: string;
  url: string;
  durationSec: number;
  method: 'clip';
}

/** ローカルファイルパスのMP4をffmpegで切り抜き */
export async function clipMp4FromFile(
  inputPath: string,
  opts: {
    startSec?: number;
    durationSec?: number;
    label?: string;
    filePath?: string;
  } = {},
): Promise<ClipMp4Result> {
  await fsp.mkdir(VIDEO_DIR, { recursive: true });
  const startSec = opts.startSec ?? 0;
  const durationSec = opts.durationSec ?? 8;
  const label = opts.label ?? `clip-${Date.now()}`;
  const filename = `${safeFilename(label)}-${Date.now()}.mp4`;
  const filePath = opts.filePath ?? path.join(VIDEO_DIR, filename);

  await runFfmpeg([
    '-y',
    '-ss', String(startSec),
    '-i', inputPath,
    '-t', String(durationSec),
    '-vf', 'scale=720:480:force_original_aspect_ratio=decrease,pad=720:480:(ow-iw)/2:(oh-ih)/2,setsar=1',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-an',
    '-movflags', '+faststart',
    filePath,
  ]);

  return {
    filename,
    filePath,
    url: await mediaUrl(filename, filePath),
    durationSec,
    method: 'clip',
  };
}

/** Discord添付などのMP4 URLをダウンロードしてffmpegで切り抜き */
export async function clipMp4FromUrl(
  sourceUrl: string,
  opts: {
    startSec?: number;
    durationSec?: number;
    label?: string;
    filePath?: string;
  } = {},
): Promise<ClipMp4Result> {
  await fsp.mkdir(VIDEO_DIR, { recursive: true });
  const startSec = opts.startSec ?? 0;
  const durationSec = opts.durationSec ?? 8;
  const label = opts.label ?? `clip-${Date.now()}`;
  const filename = `${safeFilename(label)}-${Date.now()}.mp4`;
  const filePath = opts.filePath ?? path.join(VIDEO_DIR, filename);

  // 元動画をDL
  const tmpInput = path.join(VIDEO_DIR, `tmp-input-${Date.now()}.mp4`);
  try {
    const https = await import('https');
    const http = await import('http');
    const fileStream = fs.createWriteStream(tmpInput);
    await new Promise<void>((resolve, reject) => {
      const mod = sourceUrl.startsWith('https') ? https : http;
      const dl = (url: string) => {
        mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            const loc = res.headers.location;
            if (loc) { dl(loc); return; }
          }
          if (res.statusCode !== 200) {
            reject(new Error(`ダウンロード失敗: HTTP ${res.statusCode} ${sourceUrl}`));
            return;
          }
          res.pipe(fileStream);
          fileStream.on('finish', () => resolve());
          fileStream.on('error', reject);
        }).on('error', reject);
      };
      dl(sourceUrl);
    });

    // ffmpegで切り抜き＋720x480にリサイズ
    await runFfmpeg([
      '-y',
      '-ss', String(startSec),
      '-i', tmpInput,
      '-t', String(durationSec),
      '-vf', 'scale=720:480:force_original_aspect_ratio=decrease,pad=720:480:(ow-iw)/2:(oh-ih)/2,setsar=1',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-an',
      '-movflags', '+faststart',
      filePath,
    ]);
  } finally {
    fsp.unlink(tmpInput).catch(() => {});
  }

  return {
    filename,
    filePath,
    url: await mediaUrl(filename, filePath),
    durationSec,
    method: 'clip',
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
