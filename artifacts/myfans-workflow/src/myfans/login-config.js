const path = require("node:path");

const MANUAL_INSTRUCTIONS = [
  "MyFansに手動ログインしてください",
  "SMS認証や追加認証は手動で完了してください",
  "bot検証が表示された場合は人間が手動で対応してください",
  "手動で通過できない場合はPlaywright方式を中止してください",
  "自動突破は行いません",
  "URL生成画面が表示されたらEnterを押してください",
];

const UNSAFE_PROFILE_PATTERNS = [
  /\/Library\/Application Support\/Google\/Chrome\//i,
  /\/Library\/Application Support\/Chromium\//i,
  /\/Library\/Application Support\/BraveSoftware\//i,
  /\/Library\/Application Support\/Microsoft Edge\//i,
  /\/AppData\/Local\/Google\/Chrome\/User Data\//i,
  /\/AppData\/Local\/Microsoft\/Edge\/User Data\//i,
  /\/\.config\/google-chrome\//i,
  /\/\.config\/chromium\//i,
];

function getRequiredEnv(env, key) {
  const value = (env[key] || "").trim();
  if (!value) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

function normalizeHttpsUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("MYFANS_AFFILIATE_GENERATOR_URL must be a valid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("MYFANS_AFFILIATE_GENERATOR_URL must start with http:// or https://.");
  }

  return parsed.toString();
}

function isLikelyPersonalBrowserProfile(profileDir) {
  const normalized = profileDir.replace(/\\/g, "/");
  if (UNSAFE_PROFILE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  return /\/(Default|Profile [0-9]+|Guest Profile|System Profile)$/.test(normalized);
}

function resolveLoginConfig(env = process.env) {
  const profileDirRaw = getRequiredEnv(env, "MYFANS_PROFILE_DIR");
  const generatorUrlRaw = getRequiredEnv(env, "MYFANS_AFFILIATE_GENERATOR_URL");

  const profileDir = path.resolve(profileDirRaw);
  if (isLikelyPersonalBrowserProfile(profileDir)) {
    throw new Error(
      "MYFANS_PROFILE_DIR must be a dedicated automation profile directory (not your daily browser profile).",
    );
  }

  return {
    profileDir,
    generatorUrl: normalizeHttpsUrl(generatorUrlRaw),
  };
}

module.exports = {
  MANUAL_INSTRUCTIONS,
  isLikelyPersonalBrowserProfile,
  normalizeHttpsUrl,
  resolveLoginConfig,
};
