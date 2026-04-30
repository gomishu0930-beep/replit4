const { Anthropic } = require("@anthropic-ai/sdk");

const ALLOWED_TONES = new Set(["natural", "cute", "bold", "simple"]);
const MIN_MAX_LENGTH = 100;
const MAX_MAX_LENGTH = 280;
const DEFAULT_MAX_LENGTH = 250;
const DEFAULT_MODEL = "claude-3-5-sonnet-latest";
const DEFAULT_TIMEOUT_MS = 20000;

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

function arrayIncludesCaseInsensitive(text, values) {
  const lower = text.toLowerCase();
  return values.some((value) => lower.includes(String(value).toLowerCase()));
}

function countChars(text) {
  return Array.from(text).length;
}

function includesPrLabel(text) {
  const lower = text.toLowerCase();
  return lower.includes("#pr") || text.includes("広告");
}

function parsePositiveInt(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function validateRequestPayload(payload) {
  const affiliateUrl = String(payload?.affiliateUrl || "").trim();
  if (!affiliateUrl) {
    return { ok: false, statusCode: 400, message: "affiliateUrl is required." };
  }
  try {
    const parsed = new URL(affiliateUrl);
    if (!(parsed.protocol === "https:" || parsed.protocol === "http:")) {
      return { ok: false, statusCode: 400, message: "affiliateUrl must be a valid URL." };
    }
  } catch {
    return { ok: false, statusCode: 400, message: "affiliateUrl must be a valid URL." };
  }

  const variantCount = parsePositiveInt(payload?.variantCount, 3);
  if (!Number.isInteger(variantCount) || variantCount < 1 || variantCount > 10) {
    return { ok: false, statusCode: 400, message: "variantCount must be an integer between 1 and 10." };
  }

  const maxLength = parsePositiveInt(payload?.rules?.maxLength, DEFAULT_MAX_LENGTH);
  if (!Number.isInteger(maxLength) || maxLength < MIN_MAX_LENGTH || maxLength > MAX_MAX_LENGTH) {
    return {
      ok: false,
      statusCode: 400,
      message: `rules.maxLength must be an integer between ${MIN_MAX_LENGTH} and ${MAX_MAX_LENGTH}.`,
    };
  }

  const tone = String(payload?.tone || "natural").trim().toLowerCase();
  if (!ALLOWED_TONES.has(tone)) {
    return { ok: false, statusCode: 400, message: "tone must be natural, cute, bold, or simple." };
  }

  const platform = String(payload?.platform || "").trim().toLowerCase();
  if (platform !== "x") {
    return { ok: false, statusCode: 400, message: "platform must be x." };
  }

  const ngWords = payload?.rules?.ngWords;
  if (ngWords != null && !Array.isArray(ngWords)) {
    return { ok: false, statusCode: 400, message: "rules.ngWords must be an array." };
  }

  const normalizedNgWords = Array.isArray(ngWords)
    ? ngWords.map((word) => String(word || "").trim()).filter(Boolean)
    : [];

  return {
    ok: true,
    value: {
      affiliateUrl,
      tone,
      variantCount,
      platform,
      contentHints: payload?.contentHints || {},
      requirePrLabel: payload?.rules?.requirePrLabel !== false,
      maxLength,
      ngWords: normalizedNgWords,
    },
  };
}

function buildSystemPrompt() {
  return [
    "あなたは日本語X投稿文の作成者です。",
    "アフィリエイト投稿のため、広告であることを明確にしてください。",
    "短く自然な文にしてください。",
    "禁止表現は使わないでください。",
    "出力はJSONのみです。",
  ].join("\n");
}

function buildUserPrompt(input) {
  const ngWordsString = input.ngWords.length ? input.ngWords.join(", ") : "(none)";
  const hints = input.contentHints || {};
  return [
    "以下の条件でX投稿文を生成してください。",
    "",
    "必須:",
    "- 先頭付近に #PR を入れる",
    "- affiliateUrlを必ず含める",
    "- 日本語",
    `- ${input.maxLength}文字以下`,
    `- ${input.variantCount}件`,
    "- 各文面は重複させない",
    "",
    "禁止:",
    "- 露骨な性的表現",
    "- 未成年を想起させる表現",
    "- 非同意、盗撮、流出を示唆する表現",
    "- 無料、割引、限定など未確認の訴求",
    "- 絶対、100%、保証などの誇大表現",
    "- NGワード",
    "",
    `affiliateUrl: ${input.affiliateUrl}`,
    `tone: ${input.tone}`,
    `variantCount: ${input.variantCount}`,
    `maxLength: ${input.maxLength}`,
    `ngWords: ${ngWordsString}`,
    `creatorName: ${String(hints.creatorName || "")}`,
    `title: ${String(hints.title || "")}`,
    `tags: ${Array.isArray(hints.tags) ? hints.tags.join(", ") : ""}`,
    "",
    '出力JSON: {"drafts":[{"text":"..."}]}',
  ].join("\n");
}

function extractJsonObject(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw new Error("Claude response is empty.");
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Failed to parse Claude JSON response.");
  }
}

function validateGeneratedDraftText(text, affiliateUrl, maxLength, ngWords) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return { ok: false, reason: "empty text" };
  }
  if (!includesPrLabel(normalized)) {
    return { ok: false, reason: "missing #PR/広告" };
  }
  if (!normalized.includes(affiliateUrl)) {
    return { ok: false, reason: "missing affiliateUrl" };
  }
  if (countChars(normalized) > maxLength) {
    return { ok: false, reason: "exceeds maxLength" };
  }
  if (arrayIncludesCaseInsensitive(normalized, BANNED_PHRASES)) {
    return { ok: false, reason: "contains banned phrase" };
  }
  if (arrayIncludesCaseInsensitive(normalized, ngWords || [])) {
    return { ok: false, reason: "contains NG word" };
  }
  return { ok: true };
}

async function withTimeout(promise, timeoutMs) {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(Object.assign(new Error("Claude API timeout."), { statusCode: 504 }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function defaultAnthropicFactory(apiKey) {
  return new Anthropic({ apiKey });
}

function createGenerateMyfansPostsService(options = {}) {
  const anthropicFactory = options.anthropicFactory || defaultAnthropicFactory;
  return async function generateMyfansPosts({ payload, env }) {
    const validation = validateRequestPayload(payload);
    if (!validation.ok) {
      throw Object.assign(new Error(validation.message), { statusCode: validation.statusCode });
    }
    const input = validation.value;

    const apiKey = String(env?.ANTHROPIC_API_KEY || "").trim();
    if (!apiKey) {
      throw Object.assign(new Error("ANTHROPIC_API_KEY is not configured."), { statusCode: 500 });
    }

    const model = String(env?.CLAUDE_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    const timeoutMsRaw = parsePositiveInt(env?.CLAUDE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    const timeoutMs = Number.isInteger(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : DEFAULT_TIMEOUT_MS;

    const client = anthropicFactory(apiKey);
    const system = buildSystemPrompt();
    const user = buildUserPrompt(input);

    let response;
    try {
      response = await withTimeout(
        client.messages.create({
          model,
          temperature: 0.2,
          max_tokens: 900,
          system,
          messages: [{ role: "user", content: user }],
        }),
        timeoutMs,
      );
    } catch (error) {
      if (error.statusCode) {
        throw error;
      }
      throw Object.assign(new Error(`Claude API error: ${error.message}`), { statusCode: 502 });
    }

    const contentBlocks = Array.isArray(response?.content) ? response.content : [];
    const textContent = contentBlocks
      .filter((block) => block && block.type === "text")
      .map((block) => block.text || "")
      .join("\n")
      .trim();

    let parsed;
    try {
      parsed = extractJsonObject(textContent);
    } catch (error) {
      throw Object.assign(new Error(`Claude JSON parse error: ${error.message}`), { statusCode: 502 });
    }

    const drafts = Array.isArray(parsed?.drafts) ? parsed.drafts : [];
    const uniqueTexts = new Set();
    const validDrafts = [];

    for (const candidate of drafts) {
      const text = String(candidate?.text || "").trim();
      if (uniqueTexts.has(text)) {
        continue;
      }
      const check = validateGeneratedDraftText(text, input.affiliateUrl, input.maxLength, input.ngWords);
      if (!check.ok) {
        continue;
      }
      uniqueTexts.add(text);
      validDrafts.push({ text });
    }

    if (validDrafts.length === 0) {
      throw Object.assign(new Error("All generated drafts failed validation."), { statusCode: 502 });
    }

    return {
      drafts: validDrafts.slice(0, input.variantCount),
    };
  };
}

function isAuthorizedRequest(authorizationHeader, token) {
  const expected = String(token || "").trim();
  if (!expected) {
    return true;
  }
  const header = String(authorizationHeader || "");
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) {
    return false;
  }
  const received = header.slice(prefix.length).trim();
  return received === expected;
}

module.exports = {
  BANNED_PHRASES,
  buildSystemPrompt,
  buildUserPrompt,
  createGenerateMyfansPostsService,
  isAuthorizedRequest,
  validateGeneratedDraftText,
  validateRequestPayload,
};
