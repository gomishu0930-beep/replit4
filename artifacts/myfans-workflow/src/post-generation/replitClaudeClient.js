function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function withTimeout(timeoutMs, task) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return task(controller.signal).finally(() => clearTimeout(timeout));
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "");
}

function createReplitClaudeClient(options = {}) {
  const fetchImpl = /** @type {any} */ (options.fetchImpl || fetch);
  async function generateMyfansPostDrafts(input, options = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    if (!baseUrl) {
      throw Object.assign(new Error("REPLIT_CLAUDE_API_BASE_URL is not configured."), { statusCode: 500 });
    }

    const endpoint = `${baseUrl}/api/claude/generate-myfans-posts`;
    const headers = {
      "content-type": "application/json",
    };
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }
    const timeoutMs =
      Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 30000;

    let response;
    try {
      response = await withTimeout(timeoutMs, (signal) =>
        fetchImpl(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(input),
          signal,
        }),
      );
    } catch (error) {
      if (error?.name === "AbortError") {
        throw Object.assign(new Error("Replit Claude API timeout."), { statusCode: 504 });
      }
      throw Object.assign(new Error(`Replit Claude API request failed: ${error.message}`), {
        statusCode: 502,
      });
    }

    const text = await response.text();
    const body = parseJsonSafe(text);
    if (!response.ok) {
      const message = body?.error || `Replit Claude API error: ${response.status}`;
      throw Object.assign(new Error(message), { statusCode: response.status || 502 });
    }
    if (!body || !Array.isArray(body.drafts)) {
      throw Object.assign(new Error("Replit Claude API response format is invalid."), {
        statusCode: 502,
      });
    }

    return {
      drafts: body.drafts,
      responseId: body.responseId || null,
    };
  }

  return {
    generateMyfansPostDrafts,
  };
}

module.exports = {
  createReplitClaudeClient,
};
