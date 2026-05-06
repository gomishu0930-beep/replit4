import fs from 'fs';
import path from 'path';

export interface AllowedMakersConfig {
  makers: Array<{ id?: string; name: string; note?: string }>;
  allowed_video_domains: string[];
  approved_urls: string[];
}

export interface NgKeywordsConfig {
  keywords: string[];
}

const CONFIG_DIR = path.resolve(process.cwd(), 'config');
const ALLOWED_MAKERS_FILE = path.join(CONFIG_DIR, 'allowed_makers.json');
const NG_KEYWORDS_FILE = path.join(CONFIG_DIR, 'ng_keywords.json');

const DEFAULT_ALLOWED_MAKERS: AllowedMakersConfig = {
  makers: [],
  allowed_video_domains: ['cc3001.dmm.co.jp', 'cc3001.dmm.com', 'dlsoft.dmm.co.jp'],
  approved_urls: [],
};
const DEFAULT_NG_KEYWORDS: NgKeywordsConfig = { keywords: [] };

function ensureConfigDir(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function backup(file: string): void {
  if (!fs.existsSync(file)) return;
  const backupFile = `${file}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
  fs.copyFileSync(file, backupFile);
}

function atomicWrite(file: string, data: unknown): void {
  ensureConfigDir();
  backup(file);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

export function loadAllowedMakersConfig(): AllowedMakersConfig {
  const envMakers: Array<{ id?: string; name: string; note?: string }> = (process.env.FANZA_SAMPLE_VIDEO_ALLOWED_MAKERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ name, note: 'Replit Secrets: FANZA_SAMPLE_VIDEO_ALLOWED_MAKERS' }));
  const fileConfig = readJson<AllowedMakersConfig>(ALLOWED_MAKERS_FILE, DEFAULT_ALLOWED_MAKERS);
  const merged = new Map<string, { id?: string; name: string; note?: string }>();
  for (const maker of [...envMakers, ...(fileConfig.makers ?? [])]) {
    if (maker.name) merged.set(`${maker.id ?? ''}:${maker.name}`, maker);
  }
  return {
    makers: [...merged.values()],
    allowed_video_domains: fileConfig.allowed_video_domains ?? DEFAULT_ALLOWED_MAKERS.allowed_video_domains,
    approved_urls: fileConfig.approved_urls ?? [],
  };
}

export function saveAllowedMakersConfig(config: AllowedMakersConfig): AllowedMakersConfig {
  const normalized: AllowedMakersConfig = {
    makers: Array.isArray(config.makers)
      ? config.makers.map((m) => ({ id: String(m.id ?? '').trim() || undefined, name: String(m.name ?? '').trim(), note: m.note })).filter((m) => m.name)
      : [],
    allowed_video_domains: Array.isArray(config.allowed_video_domains) ? config.allowed_video_domains.map(String).filter(Boolean) : [],
    approved_urls: Array.isArray(config.approved_urls) ? config.approved_urls.map(String).filter(Boolean) : [],
  };
  atomicWrite(ALLOWED_MAKERS_FILE, normalized);
  return normalized;
}

export function loadNgKeywordsConfig(): NgKeywordsConfig {
  return readJson<NgKeywordsConfig>(NG_KEYWORDS_FILE, DEFAULT_NG_KEYWORDS);
}

export function saveNgKeywordsConfig(config: NgKeywordsConfig): NgKeywordsConfig {
  const normalized = {
    keywords: Array.isArray(config.keywords)
      ? [...new Set(config.keywords.map((k) => String(k).trim()).filter(Boolean))]
      : [],
  };
  atomicWrite(NG_KEYWORDS_FILE, normalized);
  return normalized;
}
