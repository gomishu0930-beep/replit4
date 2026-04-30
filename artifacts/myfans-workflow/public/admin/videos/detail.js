async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return body;
}

function getAssetIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function toIntValue(inputId) {
  const value = Number(document.getElementById(inputId).value);
  return Number.isFinite(value) ? Math.floor(value) : 0;
}

let currentAssetId = null;

function renderAsset(asset) {
  document.getElementById("status").textContent = `status=${asset.status} rightsConfirmed=${asset.rightsConfirmed} duration=${asset.durationSec ?? "n/a"} size=${asset.width ?? "n/a"}x${asset.height ?? "n/a"}`;
  document.getElementById("rawPath").textContent = `raw: ${asset.filePath || "(none)"}`;
  document.getElementById("cleanPath").textContent = `clean: ${asset.cleanedFilePath || "(none)"}`;

  if (asset.rawPreviewUrl) {
    document.getElementById("rawVideo").src = asset.rawPreviewUrl;
  }
  if (asset.cleanPreviewUrl) {
    document.getElementById("cleanVideo").src = asset.cleanPreviewUrl;
  } else {
    document.getElementById("cleanVideo").removeAttribute("src");
  }

  document.getElementById("uiCropTop").value = String(asset.uiCropTop || 0);
  document.getElementById("uiCropBottom").value = String(asset.uiCropBottom || 0);
  document.getElementById("uiCropLeft").value = String(asset.uiCropLeft || 0);
  document.getElementById("uiCropRight").value = String(asset.uiCropRight || 0);
}

async function refreshAsset() {
  const body = await fetchJson(`/api/videos/assets/${encodeURIComponent(currentAssetId)}`);
  renderAsset(body.asset);
}

async function init() {
  currentAssetId = getAssetIdFromQuery();
  if (!currentAssetId) {
    throw new Error("id query is required.");
  }

  await refreshAsset();

  document.getElementById("cleanBtn").addEventListener("click", async () => {
    const msg = document.getElementById("msg");
    msg.textContent = "";
    try {
      await fetchJson(`/api/videos/assets/${encodeURIComponent(currentAssetId)}/clean-ui`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uiCropTop: toIntValue("uiCropTop"),
          uiCropBottom: toIntValue("uiCropBottom"),
          uiCropLeft: toIntValue("uiCropLeft"),
          uiCropRight: toIntValue("uiCropRight"),
          uiMasks: [],
        }),
      });
      msg.textContent = "UI除去を実行しました。";
      await refreshAsset();
    } catch (error) {
      msg.textContent = error.message;
    }
  });
}

init().catch((error) => {
  const msg = document.getElementById("msg");
  if (msg) {
    msg.textContent = error.message;
  }
});
