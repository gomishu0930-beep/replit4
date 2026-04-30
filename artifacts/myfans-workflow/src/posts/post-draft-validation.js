const MAX_X_POST_LENGTH = 280;

const BANNED_PHRASES = [
  "未成年",
  "女子高生",
  "JK",
  "ロリ",
  "児童",
  "盗撮",
  "流出",
  "非同意",
  "強制",
  "無料",
  "タダ",
  "割引",
  "今だけ",
  "限定",
  "100%",
  "保証",
  "絶対",
];

function normalizeText(value) {
  return (value || "").trim();
}

function includesAdDisclosure(text) {
  const normalized = text.toLowerCase();
  return normalized.includes("#pr") || text.includes("広告");
}

function countCharacters(text) {
  return Array.from(text).length;
}

function findBannedPhrases(text) {
  const lower = text.toLowerCase();
  return BANNED_PHRASES.filter((phrase) => lower.includes(phrase.toLowerCase()));
}

function findNgWords(text, ngWords = []) {
  const lower = text.toLowerCase();
  return ngWords.filter((word) => lower.includes(String(word).toLowerCase()));
}

function validateDraftText({ text, affiliateUrl, maxLength = MAX_X_POST_LENGTH, ngWords = [] }) {
  const normalizedText = normalizeText(text);
  const normalizedAffiliateUrl = normalizeText(affiliateUrl);

  if (!normalizedText) {
    return { ok: false, error: "text is required." };
  }
  if (!includesAdDisclosure(normalizedText)) {
    return { ok: false, error: "text must include #PR or 広告 disclosure." };
  }
  if (!normalizedAffiliateUrl) {
    return { ok: false, error: "affiliateUrl is required." };
  }
  if (!normalizedText.includes(normalizedAffiliateUrl)) {
    return { ok: false, error: "text must include affiliateUrl." };
  }
  if (countCharacters(normalizedText) > maxLength) {
    return { ok: false, error: `text exceeds X max length (${maxLength}).` };
  }

  const banned = findBannedPhrases(normalizedText);
  if (banned.length > 0) {
    return {
      ok: false,
      error: `text includes banned phrase(s): ${banned.join(", ")}`,
    };
  }

  const detectedNg = findNgWords(normalizedText, ngWords);
  if (detectedNg.length > 0) {
    return {
      ok: false,
      error: `text includes NG word(s): ${detectedNg.join(", ")}`,
    };
  }

  return { ok: true };
}

module.exports = {
  BANNED_PHRASES,
  MAX_X_POST_LENGTH,
  findNgWords,
  validateDraftText,
};
