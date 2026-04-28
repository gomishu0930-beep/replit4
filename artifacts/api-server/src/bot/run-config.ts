/**
 * 実行時設定管理モジュール
 * AUTO_POST_ENABLED / DRY_RUN / 上限値 などを一元管理する。
 * 環境変数 → ファイル永続化 の2段階で管理。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../fanza-bot/data');
const CONFIG_FILE = path.join(DATA_DIR, 'run-config.json');

export interface RunConfig {
  autoPostEnabled: boolean;
  dryRun: boolean;
  maxPostsPerDay: number;
  maxPostsPerHour: number;
  cooldownMinutes: number;
  categoryWeights: {
    engagement: number;
    eroticStory: number;
    fanza: number;
    myfans: number;
  };
  safetyStrictness: 'normal' | 'strict' | 'relaxed';
  discordNotifyEnabled: boolean;
  aiReviewEnabled: boolean;
}

const DEFAULT_CONFIG: RunConfig = {
  autoPostEnabled: false,
  dryRun: true,
  maxPostsPerDay: 3,
  maxPostsPerHour: 1,
  cooldownMinutes: 60,
  categoryWeights: {
    engagement: 40,
    eroticStory: 25,
    fanza: 25,
    myfans: 10,
  },
  safetyStrictness: 'strict',
  discordNotifyEnabled: false,
  aiReviewEnabled: false,
};

let config: RunConfig = { ...DEFAULT_CONFIG };

function loadEnvOverrides(): Partial<RunConfig> {
  const overrides: Partial<RunConfig> = {};
  if (process.env.AUTO_POST_ENABLED !== undefined)
    overrides.autoPostEnabled = process.env.AUTO_POST_ENABLED === 'true';
  if (process.env.DRY_RUN !== undefined)
    overrides.dryRun = process.env.DRY_RUN === 'true';
  if (process.env.MAX_POSTS_PER_DAY)
    overrides.maxPostsPerDay = parseInt(process.env.MAX_POSTS_PER_DAY, 10);
  if (process.env.MAX_POSTS_PER_HOUR)
    overrides.maxPostsPerHour = parseInt(process.env.MAX_POSTS_PER_HOUR, 10);
  if (process.env.COOLDOWN_MINUTES)
    overrides.cooldownMinutes = parseInt(process.env.COOLDOWN_MINUTES, 10);
  return overrides;
}

export function loadRunConfig(): void {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const saved = JSON.parse(raw) as Partial<RunConfig>;
      config = {
        ...DEFAULT_CONFIG,
        ...saved,
        categoryWeights: { ...DEFAULT_CONFIG.categoryWeights, ...(saved.categoryWeights ?? {}) },
      };
    }
  } catch {
    config = { ...DEFAULT_CONFIG };
  }
  const envOverrides = loadEnvOverrides();
  config = { ...config, ...envOverrides };

  console.log(`  ⚙ [RunConfig] autoPostEnabled=${config.autoPostEnabled} dryRun=${config.dryRun} maxPerDay=${config.maxPostsPerDay}`);
}

function save(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('[RunConfig] 保存失敗:', e);
  }
}

export function getRunConfig(): RunConfig {
  return { ...config };
}

export function updateRunConfig(partial: Partial<RunConfig>): void {
  config = {
    ...config,
    ...partial,
    categoryWeights: {
      ...config.categoryWeights,
      ...(partial.categoryWeights ?? {}),
    },
  };
  save();
  console.log(`  ⚙ [RunConfig] 更新: autoPostEnabled=${config.autoPostEnabled} dryRun=${config.dryRun}`);
}

export function isAutoPostEnabled(): boolean { return config.autoPostEnabled; }
export function isDryRun(): boolean { return config.dryRun; }
export function getMaxPostsPerHour(): number { return config.maxPostsPerHour; }
export function getCooldownMinutes(): number { return config.cooldownMinutes; }
