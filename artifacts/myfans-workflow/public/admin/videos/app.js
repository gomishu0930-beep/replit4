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

function renderAssets(assets) {
  const root = document.getElementById("assets");
  if (!assets.length) {
    root.textContent = "動画素材はまだありません。";
    return;
  }
  root.innerHTML = assets
    .map((asset) => {
      const id = encodeURIComponent(asset.id);
      return `
      <article class="asset-item">
        <div><strong>${escapeHtml(asset.originalFilename || "(unknown)")}</strong></div>
        <div class="mono">status=${escapeHtml(asset.status)} | duration=${escapeHtml(asset.durationSec ?? "n/a")} | ${escapeHtml(asset.width ?? "n/a")}x${escapeHtml(asset.height ?? "n/a")}</div>
        <div class="mono">raw=${escapeHtml(asset.filePath || "")}</div>
        <div class="mono">clean=${escapeHtml(asset.cleanedFilePath || "(none)")}</div>
        <div style="margin-top:6px"><a href="/admin/videos/detail.html?id=${id}">詳細を開く</a></div>
      </article>`;
    })
    .join("");
}

async function refreshAssets() {
  const body = await fetchJson("/api/videos/assets");
  renderAssets(body.assets || []);
}

async function init() {
  const msg = document.getElementById("msg");
  const registerBtn = document.getElementById("registerBtn");
  const filePathInput = document.getElementById("filePath");
  const rightsConfirmedInput = document.getElementById("rightsConfirmed");

  registerBtn.addEventListener("click", async () => {
    msg.textContent = "";
    try {
      await fetchJson("/api/videos/assets/register-local", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filePath: filePathInput.value,
          rightsConfirmed: rightsConfirmedInput.checked,
        }),
      });
      msg.textContent = "動画を登録しました。";
      filePathInput.value = "";
      rightsConfirmedInput.checked = false;
      await refreshAssets();
    } catch (error) {
      msg.textContent = error.message;
    }
  });

  await refreshAssets();
}

init().catch((error) => {
  const msg = document.getElementById("msg");
  if (msg) {
    msg.textContent = error.message;
  }
});
