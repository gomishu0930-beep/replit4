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

async function changeStatus(id, status) {
  await fetchJson(`/api/myfans/posts/drafts/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

async function attachClip(id, clipId) {
  await fetchJson(`/api/myfans/posts/drafts/${encodeURIComponent(id)}/attach-clip`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clipId }),
  });
}

function clipSelectOptions(clips, selectedId) {
  const options = ['<option value="">(clip未選択)</option>'];
  for (const clip of clips) {
    const selected = clip.id === selectedId ? "selected" : "";
    options.push(
      `<option value="${escapeHtml(clip.id)}" ${selected}>${escapeHtml(clip.id)} (${escapeHtml(clip.status)})</option>`,
    );
  }
  return options.join("");
}

function renderDrafts(drafts, clips) {
  const root = document.getElementById("drafts");
  if (!drafts.length) {
    root.textContent = "下書きはまだありません。";
    return;
  }

  root.innerHTML = drafts
    .map((draft) => {
      const safeText = escapeHtml(draft.text || "");
      const safeAffiliate = escapeHtml(draft.affiliateUrl || "");
      const clipPreview = draft.clip?.previewUrl
        ? `<video controls src="${escapeHtml(draft.clip.previewUrl)}"></video>
           <a href="${escapeHtml(draft.clip.previewUrl)}" target="_blank" rel="noreferrer noopener">clip確認/ダウンロード</a>`
        : `<p class="muted">clip未紐付け</p>`;
      return `
        <article class="draft-item">
          <div class="row">
            <strong>${escapeHtml(draft.id)}</strong>
            <span class="mono">status=${escapeHtml(draft.status)}</span>
            <span class="mono">affiliateJobId=${escapeHtml(draft.affiliateJobId)}</span>
          </div>

          <div style="margin-top:8px">
            <label>text</label>
            <textarea readonly>${safeText}</textarea>
            <button data-action="copy-text" data-id="${escapeHtml(draft.id)}">投稿文コピー</button>
          </div>

          <p class="mono">affiliateUrl: ${safeAffiliate}</p>
          <p class="mono">clipId: ${escapeHtml(draft.clipId || "(none)")}</p>

          ${clipPreview}

          <div class="row" style="margin-top:8px">
            <button data-action="set-status" data-id="${escapeHtml(draft.id)}" data-status="approved">approved</button>
            <button data-action="set-status" data-id="${escapeHtml(draft.id)}" data-status="rejected">rejected</button>
            <button data-action="set-status" data-id="${escapeHtml(draft.id)}" data-status="draft">draft</button>
          </div>

          <div class="row" style="margin-top:8px">
            <select data-role="clip-select" data-id="${escapeHtml(draft.id)}">
              ${clipSelectOptions(clips, draft.clipId)}
            </select>
            <button data-action="attach-clip" data-id="${escapeHtml(draft.id)}">clip紐付け</button>
          </div>
        </article>
      `;
    })
    .join("");
}

async function loadData() {
  const [draftBody, clipsBody] = await Promise.all([
    fetchJson("/api/myfans/posts/drafts"),
    fetchJson("/api/videos/clips"),
  ]);
  return {
    clips: clipsBody.clips || [],
    drafts: draftBody.drafts || [],
  };
}

async function init() {
  const msg = document.getElementById("msg");

  async function refresh() {
    const { drafts, clips } = await loadData();
    renderDrafts(drafts, clips);
  }

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.dataset.action;
    if (!action) {
      return;
    }

    msg.textContent = "";
    try {
      const id = target.dataset.id;
      if (action === "copy-text") {
        const textArea = target.parentElement?.querySelector("textarea");
        await navigator.clipboard.writeText(textArea?.value || "");
        msg.textContent = "投稿文をコピーしました。";
        return;
      }
      if (action === "set-status") {
        await changeStatus(id, target.dataset.status);
        msg.textContent = "statusを更新しました。";
        await refresh();
        return;
      }
      if (action === "attach-clip") {
        const select = document.querySelector(`select[data-role="clip-select"][data-id="${CSS.escape(id)}"]`);
        const clipId = select?.value;
        if (!clipId) {
          throw new Error("clipIdを選択してください。");
        }
        await attachClip(id, clipId);
        msg.textContent = "clipを紐付けました。";
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
