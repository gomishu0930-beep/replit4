import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../fanza-bot/data');
const STATE_FILE = path.join(DATA_DIR, 'safety-state.json');

export type AutomationLevel = 'MANUAL_ONLY' | 'SEMI_AUTO' | 'FULL_AUTO';

export interface SafetyState {
  accountCreatedAt: string;
  followerCount: number;
  automationLevel: AutomationLevel;
  dailyPostLimit: number;
  todayPostCount: number;
  todayAffiliateCount: number;
  todayNonAffiliateCount: number;
  todayFollowCount: number;
  consecutiveAffiliateCount: number;
  lastPostAt: string | null;
  lastAffiliatePostAt: string | null;
  lastResetDate: string;
  maxAffiliateRatio: number;
  totalPosts: number;
  totalAffiliatePosts: number;
  riskScore: number;
  riskHistory: { date: string; score: number }[];
  config: SafetyConfig;
}

export interface SafetyConfig {
  manualOnlyDays: number;
  semiAutoMinFollowers: number;
  fullAutoMinFollowers: number;
  maxDailyFollows: number;
  maxAffiliateRatioPct: number;
  maxConsecutiveAffiliate: number;
  postLimitsByWeek: { week: number; limit: number }[];
}

const DEFAULT_CONFIG: SafetyConfig = {
  manualOnlyDays: 30,
  semiAutoMinFollowers: 300,
  fullAutoMinFollowers: 1000,
  maxDailyFollows: 50,
  maxAffiliateRatioPct: 30,
  maxConsecutiveAffiliate: 1,
  postLimitsByWeek: [
    { week: 1, limit: 3 },
    { week: 2, limit: 3 },
    { week: 3, limit: 5 },
    { week: 4, limit: 5 },
    { week: 5, limit: 8 },
    { week: 6, limit: 8 },
    { week: 7, limit: 10 },
    { week: 8, limit: 10 },
    { week: 9, limit: 12 },
    { week: 10, limit: 12 },
    { week: 11, limit: 12 },
    { week: 12, limit: 12 },
  ],
};

function defaultState(): SafetyState {
  return {
    accountCreatedAt: new Date().toISOString(),
    followerCount: 0,
    automationLevel: 'MANUAL_ONLY',
    dailyPostLimit: 3,
    todayPostCount: 0,
    todayAffiliateCount: 0,
    todayNonAffiliateCount: 0,
    todayFollowCount: 0,
    consecutiveAffiliateCount: 0,
    lastPostAt: null,
    lastAffiliatePostAt: null,
    lastResetDate: jstToday(),
    maxAffiliateRatio: 30,
    totalPosts: 0,
    totalAffiliatePosts: 0,
    riskScore: 0,
    riskHistory: [],
    config: { ...DEFAULT_CONFIG },
  };
}

function jstToday(): string {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}

function jstNow(): Date {
  return new Date(Date.now() + 9 * 3600000);
}

let state: SafetyState = defaultState();

export function loadSafetyState(): void {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      const loaded = JSON.parse(raw);
      state = { ...defaultState(), ...loaded, config: { ...DEFAULT_CONFIG, ...(loaded.config ?? {}) } };
    }
  } catch {
    state = defaultState();
  }
  resetDailyIfNeeded();
}

function save(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('[Safety] 保存失敗:', e);
  }
}

function resetDailyIfNeeded(): void {
  const today = jstToday();
  if (state.lastResetDate !== today) {
    state.todayPostCount = 0;
    state.todayAffiliateCount = 0;
    state.todayNonAffiliateCount = 0;
    state.todayFollowCount = 0;
    state.lastResetDate = today;
    save();
  }
}

export function getAccountAgeDays(): number {
  const created = new Date(state.accountCreatedAt).getTime();
  return Math.floor((Date.now() - created) / 86400000);
}

function getAccountWeek(): number {
  return Math.floor(getAccountAgeDays() / 7) + 1;
}

function computeAutomationLevel(): AutomationLevel {
  const ageDays = getAccountAgeDays();
  if (ageDays < state.config.manualOnlyDays) return 'MANUAL_ONLY';
  if (state.followerCount >= state.config.fullAutoMinFollowers) return 'FULL_AUTO';
  if (state.followerCount >= state.config.semiAutoMinFollowers) return 'SEMI_AUTO';
  return 'MANUAL_ONLY';
}

function computeDailyPostLimit(): number {
  const week = getAccountWeek();
  const entry = state.config.postLimitsByWeek
    .filter(w => w.week <= week)
    .sort((a, b) => b.week - a.week)[0];
  return entry?.limit ?? 3;
}

function computeRiskScore(): number {
  let score = 0;
  const ageDays = getAccountAgeDays();
  if (ageDays < 7) score += 30;
  else if (ageDays < 14) score += 20;
  else if (ageDays < 30) score += 10;

  const ratio = state.totalPosts > 0
    ? (state.totalAffiliatePosts / state.totalPosts) * 100
    : 0;
  if (ratio > 40) score += 30;
  else if (ratio > 30) score += 20;
  else if (ratio > 20) score += 10;

  if (state.consecutiveAffiliateCount >= 3) score += 20;
  else if (state.consecutiveAffiliateCount >= 2) score += 10;

  if (state.todayPostCount >= state.dailyPostLimit) score += 15;
  else if (state.todayPostCount >= state.dailyPostLimit * 0.8) score += 5;

  if (state.todayFollowCount > 40) score += 15;
  else if (state.todayFollowCount > 30) score += 5;

  return Math.min(100, score);
}

export interface PostValidation {
  allowed: boolean;
  errors: string[];
  warnings: string[];
  riskScore: number;
  suggestedActions: string[];
}

export function validatePost(isAffiliate: boolean): PostValidation {
  resetDailyIfNeeded();
  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  if (state.todayPostCount >= state.dailyPostLimit) {
    errors.push(`本日の投稿上限(${state.dailyPostLimit}件)に達しています`);
  }

  if (isAffiliate) {
    if (state.consecutiveAffiliateCount >= state.config.maxConsecutiveAffiliate) {
      errors.push(`連続アフィリ投稿は${state.config.maxConsecutiveAffiliate}件までです。非アフィリ投稿を挟んでください`);
      suggestions.push('雑談・トレンドコメント・RTなどの非アフィリ投稿を先に行ってください');
    }

    const futureRatio = state.totalPosts > 0
      ? ((state.totalAffiliatePosts + 1) / (state.totalPosts + 1)) * 100
      : 100;
    if (futureRatio > state.config.maxAffiliateRatioPct) {
      errors.push(`アフィリ比率が${state.config.maxAffiliateRatioPct}%を超えます（現在${futureRatio.toFixed(1)}%）`);
      suggestions.push('非アフィリ投稿を増やしてください');
    }
    if (futureRatio > state.config.maxAffiliateRatioPct - 5) {
      warnings.push(`アフィリ比率${futureRatio.toFixed(1)}%（上限${state.config.maxAffiliateRatioPct}%に接近中）`);
    }
  }

  const risk = computeRiskScore();

  return {
    allowed: errors.length === 0,
    errors,
    warnings,
    riskScore: risk,
    suggestedActions: suggestions,
  };
}

export function recordPostEvent(isAffiliate: boolean): void {
  resetDailyIfNeeded();
  state.todayPostCount++;
  state.totalPosts++;
  state.lastPostAt = new Date().toISOString();

  if (isAffiliate) {
    state.todayAffiliateCount++;
    state.totalAffiliatePosts++;
    state.consecutiveAffiliateCount++;
    state.lastAffiliatePostAt = new Date().toISOString();
  } else {
    state.todayNonAffiliateCount++;
    state.consecutiveAffiliateCount = 0;
  }

  state.riskScore = computeRiskScore();
  const today = jstToday();
  const existing = state.riskHistory.find(h => h.date === today);
  if (existing) {
    existing.score = state.riskScore;
  } else {
    state.riskHistory.push({ date: today, score: state.riskScore });
    if (state.riskHistory.length > 90) state.riskHistory.shift();
  }

  save();
}

export function recordFollowEvent(count: number = 1): PostValidation {
  resetDailyIfNeeded();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (state.todayFollowCount + count > state.config.maxDailyFollows) {
    errors.push(`本日のフォロー上限(${state.config.maxDailyFollows}件)を超えます`);
  }
  if (state.todayFollowCount + count > state.config.maxDailyFollows - 10) {
    warnings.push(`フォロー数${state.todayFollowCount + count}/${state.config.maxDailyFollows}（上限に接近中）`);
  }

  if (errors.length === 0) {
    state.todayFollowCount += count;
    save();
  }

  return { allowed: errors.length === 0, errors, warnings, riskScore: computeRiskScore(), suggestedActions: [] };
}

export function updateFollowerCount(count: number): void {
  state.followerCount = count;
  state.automationLevel = computeAutomationLevel();
  state.dailyPostLimit = computeDailyPostLimit();
  save();
}

export function updateConfig(partial: Partial<SafetyConfig>): void {
  state.config = { ...state.config, ...partial };
  state.automationLevel = computeAutomationLevel();
  state.dailyPostLimit = computeDailyPostLimit();
  save();
}

export function setAccountCreatedAt(dateStr: string): void {
  state.accountCreatedAt = dateStr;
  state.automationLevel = computeAutomationLevel();
  state.dailyPostLimit = computeDailyPostLimit();
  save();
}

export function getSafetyStatus() {
  resetDailyIfNeeded();
  const ageDays = getAccountAgeDays();
  const week = getAccountWeek();
  const ratio = state.totalPosts > 0
    ? (state.totalAffiliatePosts / state.totalPosts) * 100
    : 0;

  state.automationLevel = computeAutomationLevel();
  state.dailyPostLimit = computeDailyPostLimit();
  state.riskScore = computeRiskScore();

  return {
    ...state,
    accountAgeDays: ageDays,
    accountWeek: week,
    currentAffiliateRatio: parseFloat(ratio.toFixed(1)),
    automationRequirements: {
      semiAuto: {
        minFollowers: state.config.semiAutoMinFollowers,
        minAccountAgeDays: state.config.manualOnlyDays,
        followersMet: state.followerCount >= state.config.semiAutoMinFollowers,
        ageMet: ageDays >= state.config.manualOnlyDays,
      },
      fullAuto: {
        minFollowers: state.config.fullAutoMinFollowers,
        followersMet: state.followerCount >= state.config.fullAutoMinFollowers,
      },
    },
    remainingPostsToday: Math.max(0, state.dailyPostLimit - state.todayPostCount),
    remainingFollowsToday: Math.max(0, state.config.maxDailyFollows - state.todayFollowCount),
  };
}

export function getRiskHistory(days: number = 30) {
  return state.riskHistory.slice(-days);
}
