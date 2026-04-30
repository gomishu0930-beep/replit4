const path = require("node:path");
const { mkdir } = require("node:fs/promises");
const { ERROR_CODES } = require("./types");
const {
  detectVerificationSignalsFromSnapshot,
  takeVerificationSnapshot,
} = require("./verification-detection");

const VERIFICATION_REQUIRED_MESSAGE =
  "MyFans側のbot検証が表示されています。自動突破は行いません。通常ブラウザで手動生成するか、公式サポートに確認してください。";

function defaultNow() {
  return new Date();
}

function createScreenshotPath(sourceUrl, now = defaultNow()) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const safeUrl = (sourceUrl || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return path.join(".local", "myfans-debug", `verification-${stamp}-${safeUrl}.png`);
}

async function saveVerificationScreenshot(page, sourceUrl, nowProvider = defaultNow) {
  const screenshotPath = createScreenshotPath(sourceUrl, nowProvider());
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

async function detectVerificationState(page) {
  const snapshot = await takeVerificationSnapshot(page);
  return detectVerificationSignalsFromSnapshot(snapshot);
}

async function generateOne(options = {}) {
  const { page, sourceUrl, nowProvider } = options;
  if (!page) {
    throw new Error("page is required");
  }
  if (!sourceUrl) {
    throw new Error("sourceUrl is required");
  }

  const verification = await detectVerificationState(page);
  if (verification.detected) {
    const screenshotPath = await saveVerificationScreenshot(page, sourceUrl, nowProvider);

    return {
      status: "error",
      sourceUrl,
      errorCode: ERROR_CODES.VERIFICATION_REQUIRED,
      errorMessage: VERIFICATION_REQUIRED_MESSAGE,
      screenshotPath,
    };
  }

  return {
    status: "skipped",
    sourceUrl,
    message: "Generator flow is not implemented yet.",
  };
}

module.exports = {
  VERIFICATION_REQUIRED_MESSAGE,
  createScreenshotPath,
  detectVerificationState,
  generateOne,
  saveVerificationScreenshot,
};
