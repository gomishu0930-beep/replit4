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

function queryValue(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

let selectedClipId = null;
let availableClips = [];

function setMessage(message) {
  document.getElementById("msg").textContent = message;
}

function renderClips(clips) {
  const root = document.getElementById("clips");
  if (!clips.length) {
    root.textContent = "使用可能clipがありません。";
    return;
  }
  root.innerHTML = clips
    .map((clip) => {
      const selected = selectedClipId === clip.id ? " (選択中)" : "";
      return `
        <article class="clip-item">
          <div class="mono">${escapeHtml(clip.id)} ${escapeHtml(clip.status)}${selected}</div>
          ${clip.previewUrl ? `<video controls src="${escapeHtml(clip.previewUrl)}"></video>` : "<p>previewなし</p>"}
          <div class="row" style="margin-top:6px">
            <button data-action="select-clip" data-id="${escapeHtml(clip.id)}">このclipを使う</button>
            ${clip.previewUrl ? `<a href="${escapeHtml(clip.previewUrl)}" target="_blank" rel="noreferrer noopener">clip確認/ダウンロード</a>` : ""}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderDrafts(drafts) {
  const root = document.getElementById("drafts");
  if (!drafts.length) {
    root.textContent = "まだ生成されていません。";
    return;
  }
  root.innerHTML = drafts
    .map((draft) => {
      return `
        <article class="draft-item">
          <div class="mono">${escapeHtml(draft.id)} status=${escapeHtml(draft.status)} affiliateJobId=${escapeHtml(draft.affiliateJobId)}</div>
          <textarea readonly>${escapeHtml(draft.text || "")}</textarea>
          <div class="row">
            <button data-action="copy-draft" data-text="${escapeHtml(draft.text || "")}">投稿文コピー</button>
            <button data-action="set-draft-status" data-id="${escapeHtml(draft.id)}" data-status="approved">approved</button>
            <button data-action="set-draft-status" data-id="${escapeHtml(draft.id)}" data-status="rejected">rejected</button>
          </div>
          ${draft.clip?.previewUrl ? `<video controls src="${escapeHtml(draft.clip.previewUrl)}"></video>` : ""}
          ${draft.clip?.previewUrl ? `<a href="${escapeHtml(draft.clip.previewUrl)}" target="_blank" rel="noreferrer noopener">clip確認/ダウンロード</a>` : ""}
        </article>
      `;
    })
    .join("");
}

async function loadUsableClips() {
  const body = await fetchJson("/api/videos/clips");
  availableClips = (body.clips || []).filter((clip) => clip.status === "approved" || clip.status === "generated");
  renderClips(availableClips);
}

async function loadAffiliateJob() {
  const affiliateJobId = document.getElementById("affiliateJobId").value.trim();
  if (!affiliateJobId) {
    throw new Error("affiliateJobIdを入力してください。");
  }
  const body = await fetchJson(`/api/myfans/affiliate/jobs/${encodeURIComponent(affiliateJobId)}`);
  const affiliateUrl = body.job.affiliateUrl || "";
  if (!affiliateUrl) {
    document.getElementById("affiliateUrl").textContent = "affiliateUrl: (none)";
    throw new Error("affiliateUrl保存後に生成できます。");
  }
  document.getElementById("affiliateUrl").textContent = `affiliateUrl: ${affiliateUrl}`;
}

async function generateWithClip() {
  const affiliateJobId = document.getElementById("affiliateJobId").value.trim();
  if (!affiliateJobId) {
    throw new Error("affiliateJobIdを入力してください。");
  }
  const tone = document.getElementById("tone").value;
  const variantCount = Number(document.getElementById("variantCount").value);

  const payload = {
    affiliateJobId,
    tone,
    variantCount,
  };
  if (selectedClipId) {
    payload.clipId = selectedClipId;
  }

  const body = await fetchJson("/api/myfans/posts/generate-drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  renderDrafts(body.drafts || []);
}

async function setDraftStatus(id, status) {
  await fetchJson(`/api/myfans/posts/drafts/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

async function init() {
  const prefillJobId = queryValue("affiliateJobId");
  if (prefillJobId) {
    document.getElementById("affiliateJobId").value = prefillJobId;
  }

  await loadUsableClips();

  document.getElementById("loadJobBtn").addEventListener("click", async () => {
    try {
      await loadAffiliateJob();
      setMessage("");
    } catch (error) {
      setMessage(error.message);
    }
  });

  document.getElementById("generateBtn").addEventListener("click", async () => {
    try {
      await generateWithClip();
      setMessage("draftを生成しました。");
    } catch (error) {
      setMessage(error.message);
    }
  });

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.dataset.action;
    if (!action) {
      return;
    }

    try {
      if (action === "select-clip") {
        selectedClipId = target.dataset.id;
        document.getElementById("selectedClipId").textContent = selectedClipId;
        renderClips(availableClips);
        setMessage("clipを選択しました。");
        return;
      }
      if (action === "copy-draft") {
        await navigator.clipboard.writeText(target.dataset.text || "");
        setMessage("投稿文をコピーしました。");
        return;
      }
      if (action === "set-draft-status") {
        await setDraftStatus(target.dataset.id, target.dataset.status);
        setMessage("draft statusを更新しました。");
        return;
      }
    } catch (error) {
      setMessage(error.message);
    }
  });
}

init().catch((error) => {
  setMessage(error.message);
});
