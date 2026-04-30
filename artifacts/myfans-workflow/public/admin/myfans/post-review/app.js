async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return body;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hasDisclosure(text) {
  const normalized = String(text || "").toLowerCase();
  return normalized.includes("#pr") || String(text || "").includes("広告");
}

function containsAffiliateUrl(text, affiliateUrl) {
  return Boolean((affiliateUrl || "").trim()) && String(text || "").includes(affiliateUrl);
}

function toQueryString(filters) {
  const params = new URLSearchParams();
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.hasClip !== "") {
    params.set("hasClip", filters.hasClip);
  }
  if (filters.generatedBy) {
    params.set("generatedBy", filters.generatedBy);
  }
  if (filters.limit) {
    params.set("limit", String(filters.limit));
  }
  return params.toString();
}

function renderDrafts(drafts) {
  const root = document.getElementById("drafts");
  if (!drafts.length) {
    root.textContent = "表示できる下書きがありません。";
    return;
  }

  root.innerHTML = drafts
    .map((draft) => {
      const prOk = hasDisclosure(draft.text);
      const affiliateOk = containsAffiliateUrl(draft.text, draft.affiliateUrl);
      const postReady = Boolean(draft.postReady?.ok);
      const candidate = draft.status === "approved" && prOk && affiliateOk && postReady;

      const prBadge = prOk
        ? '<span class="badge ok">#PR/広告 OK</span>'
        : '<span class="badge bad">#PR/広告 NG</span>';
      const affiliateBadge = affiliateOk
        ? '<span class="badge ok">affiliateUrl OK</span>'
        : '<span class="badge bad">affiliateUrl NG</span>';
      const candidateBadge = candidate
        ? '<span class="badge ok">投稿候補</span>'
        : '<span class="badge warn">投稿候補外</span>';

      const sourceUrl = draft.affiliateJob?.sourceUrl || "(unknown)";
      const affiliateJobStatus = draft.affiliateJob?.status || "(unknown)";
      const previewUrl = draft.clip?.previewUrl || null;

      return `
        <article class="draft-item">
          <div class="row">
            <strong>${escapeHtml(draft.id)}</strong>
            <span class="mono">status=${escapeHtml(draft.status)}</span>
            <span class="mono">generated_by=${escapeHtml(draft.generatedBy || "null")}</span>
            ${candidateBadge}
          </div>

          <div class="row" style="margin-top: 6px">
            ${prBadge}
            ${affiliateBadge}
          </div>

          <div style="margin-top: 8px">
            <label>draft text</label>
            <textarea readonly data-role="draft-text" data-id="${escapeHtml(draft.id)}">${escapeHtml(draft.text || "")}</textarea>
          </div>

          <div class="row" style="margin-top: 8px">
            <button data-action="copy-text" data-id="${escapeHtml(draft.id)}">投稿文コピー</button>
            <button data-action="copy-affiliate" data-value="${escapeHtml(draft.affiliateUrl || "")}" class="outline">affiliateUrlコピー</button>
          </div>

          <p class="mono">affiliateUrl: ${escapeHtml(draft.affiliateUrl || "")}</p>
          <p class="mono">sourceUrl: ${escapeHtml(sourceUrl)}</p>
          <p class="mono">affiliateJob status: ${escapeHtml(affiliateJobStatus)}</p>
          <p class="mono">postReady: ${escapeHtml(draft.postReady?.ok ? "ok" : `ng (${draft.postReady?.reason || "unknown"})`)}</p>
          <p class="mono">created_at: ${escapeHtml(draft.createdAt || "")}</p>
          <p class="mono">posted_at: ${escapeHtml(draft.postedAt || "")}</p>

          ${previewUrl ? `<video controls src="${escapeHtml(previewUrl)}"></video>` : '<p class="muted">clipなし</p>'}
          <div class="row" style="margin-top: 6px">
            ${previewUrl ? `<a href="${escapeHtml(previewUrl)}" target="_blank" rel="noreferrer noopener">clipダウンロード/確認</a>` : ""}
            ${draft.clip?.outputPath ? `<span class="mono">${escapeHtml(draft.clip.outputPath)}</span>` : ""}
          </div>

          <div class="row" style="margin-top: 8px">
            <button data-action="set-status" data-id="${escapeHtml(draft.id)}" data-status="approved" class="success">approved</button>
            <button data-action="set-status" data-id="${escapeHtml(draft.id)}" data-status="rejected" class="danger">rejected</button>
            <button data-action="set-status" data-id="${escapeHtml(draft.id)}" data-status="draft" class="outline">draft</button>
            <button data-action="mark-posted" data-id="${escapeHtml(draft.id)}" ${candidate ? "" : "disabled"}>投稿済みにする</button>
          </div>
        </article>
      `;
    })
    .join("");
}

async function patchStatus(id, status) {
  return fetchJson(`/api/myfans/posts/drafts/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

async function markManuallyPosted(id) {
  return fetchJson(`/api/myfans/posts/drafts/${encodeURIComponent(id)}/mark-manually-posted`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

function readFilters() {
  return {
    status: document.getElementById("statusFilter").value,
    hasClip: document.getElementById("clipFilter").value,
    generatedBy: document.getElementById("generatedByFilter").value,
    limit: Number(document.getElementById("limitFilter").value || 0) || undefined,
  };
}

async function loadDrafts() {
  const query = toQueryString(readFilters());
  const body = await fetchJson(`/api/myfans/posts/drafts${query ? `?${query}` : ""}`);
  return body.drafts || [];
}

async function init() {
  const msg = document.getElementById("msg");

  async function refresh() {
    const drafts = await loadDrafts();
    renderDrafts(drafts);
    msg.textContent = `${drafts.length}件を表示中`; 
  }

  document.getElementById("applyFilterBtn").addEventListener("click", async () => {
    try {
      await refresh();
    } catch (error) {
      msg.textContent = error.message;
    }
  });

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.dataset.action) {
      return;
    }

    msg.textContent = "";
    try {
      const action = target.dataset.action;
      const id = target.dataset.id;

      if (action === "copy-text") {
        const container = target.closest(".draft-item");
        const textArea = container?.querySelector("textarea[data-role='draft-text']");
        await navigator.clipboard.writeText(textArea?.value || "");
        msg.textContent = "投稿文をコピーしました。";
        return;
      }
      if (action === "copy-affiliate") {
        await navigator.clipboard.writeText(target.dataset.value || "");
        msg.textContent = "affiliateUrlをコピーしました。";
        return;
      }
      if (action === "set-status") {
        await patchStatus(id, target.dataset.status);
        msg.textContent = "statusを更新しました。";
        await refresh();
        return;
      }
      if (action === "mark-posted") {
        await markManuallyPosted(id);
        msg.textContent = "手動投稿済みに更新しました。";
        await refresh();
      }
    } catch (error) {
      msg.textContent = error.message;
    }
  });

  await refresh();
}

init().catch((error) => {
  const msg = document.getElementById("msg");
  if (msg) {
    msg.textContent = error.message;
  }
});
