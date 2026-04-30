const VERIFICATION_KEYWORDS = [
  "bot",
  "ボット",
  "認証",
  "検証",
  "verify",
  "verification",
  "captcha",
  "cloudflare",
  "challenge",
];

function includesKeyword(value, keywords = VERIFICATION_KEYWORDS) {
  const normalized = (value || "").toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function detectVerificationSignalsFromSnapshot(snapshot) {
  const url = snapshot?.url || "";
  const title = snapshot?.title || "";
  const visibleText = snapshot?.visibleText || "";

  const reasons = [];

  if (includesKeyword(url)) {
    reasons.push("url_keyword");
  }
  if (includesKeyword(title)) {
    reasons.push("title_keyword");
  }
  if (includesKeyword(visibleText)) {
    reasons.push("text_keyword");
  }

  return {
    detected: reasons.length > 0,
    reasons,
  };
}

async function takeVerificationSnapshot(page) {
  const [url, title, visibleText] = await Promise.all([
    Promise.resolve(page.url()),
    page.title(),
    page.evaluate(() => document.body?.innerText || ""),
  ]);

  return { url, title, visibleText };
}

module.exports = {
  VERIFICATION_KEYWORDS,
  detectVerificationSignalsFromSnapshot,
  includesKeyword,
  takeVerificationSnapshot,
};
