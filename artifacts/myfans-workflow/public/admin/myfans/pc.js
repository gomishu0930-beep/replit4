/* ===== State ===== */
let currentJob = null;
let currentAsset = null;
let selectedClipId = null;
let currentDraftIds = [];

/* ===== Utils ===== */
async function api(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setMsg(id, text, type = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = "msg" + (type ? " " + type : "");
}

function setDisabled(cardId, disabled) {
  const card = document.getElementById(cardId);
  if (!card) return;
  card.classList.toggle("disabled", disabled);
}

function updateStepBadges(activeStep) {
  for (let i = 1; i <= 3; i++) {
    const badge = document.getElementById(`stepBadge${i}`);
    if (!badge) continue;
    badge.className = "step-badge";
    if (i < activeStep) badge.classList.add("done");
    else if (i === activeStep) badge.classList.add("active");
  }
}

/* ===== Step 1: Job creation ===== */
async function handleCreateJob() {
  const sourceUrl = document.getElementById("sourceUrl").value.trim();
  const affiliateUrl = document.getElementById("affiliateUrl").value.trim();
  setMsg("step1Msg", "");

  if (!sourceUrl || !affiliateUrl) {
    setMsg("step1Msg", "両方のURLを入力してください。", "err");
    return;
  }

  const btn = document.getElementById("createJobBtn");
  btn.disabled = true;
  setMsg("step1Msg", "ジョブを作成中...");

  try {
    const data = await api("/api/myfans/affiliate/jobs/direct", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceUrl, affiliateUrl }),
    });
    currentJob = data.job;
    setMsg("step1Msg", `✅ ジョブ作成完了 (ID: ${currentJob.id.slice(0, 8)}...)`, "ok");
    setDisabled("step2Card", false);
    updateStepBadges(2);
    await refreshHistory();
  } catch (err) {
    setMsg("step1Msg", err.message, "err");
    btn.disabled = false;
  }
}

/* ===== Step 2: Video registration ===== */
async function handleRegisterVideo() {
  const raw = document.getElementById("videoInput").value.trim();
  setMsg("videoMsg", "");
  if (!raw) {
    setMsg("videoMsg", "URLまたはファイルパスを入力してください。", "err");
    return;
  }

  const btn = document.getElementById("registerVideoBtn");
  btn.disabled = true;
  setMsg("videoMsg", "動画を登録中...");

  try {
    let data;
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      data = await api("/api/videos/assets/register-from-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUrl: raw, rightsConfirmed: true }),
      });
    } else {
      data = await api("/api/videos/assets/register-local", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filePath: raw, rightsConfirmed: true }),
      });
    }
    currentAsset = data.asset;
    showVideoPreview(currentAsset);
    setMsg("videoMsg", `✅ 登録完了 (${Math.round((currentAsset.durationSec || 0))}秒 / ${currentAsset.width}×${currentAsset.height})`, "ok");
  } catch (err) {
    setMsg("videoMsg", err.message, "err");
    btn.disabled = false;
  }
}

function showVideoPreview(asset) {
  const section = document.getElementById("videoPreviewSection");
  section.style.display = "block";

  const player = document.getElementById("videoPlayer");
  const mediaUrl = asset.rawMediaUrl || asset.cleanedMediaUrl || null;
  if (mediaUrl) {
    player.src = mediaUrl;
    player.style.display = "block";
  } else {
    player.style.display = "none";
  }

  const meta = document.getElementById("videoMeta");
  meta.textContent = `ID: ${asset.id} / ${Math.round(asset.durationSec || 0)}秒 / ${asset.width ?? "?"}×${asset.height ?? "?"}`;
}

/* ===== UI Crop ===== */
function initSliders() {
  ["Top", "Bottom", "Left", "Right"].forEach((dir) => {
    const slider = document.getElementById(`crop${dir}`);
    const val = document.getElementById(`val${dir}`);
    if (!slider || !val) return;
    slider.addEventListener("input", () => { val.textContent = slider.value; });
  });
}

async function handleApplyUi() {
  if (!currentAsset) return;
  const btn = document.getElementById("applyUiBtn");
  btn.disabled = true;
  setMsg("uiMsg", "UI除去処理中...");

  try {
    const data = await api(`/api/videos/assets/${currentAsset.id}/clean-ui`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uiCropTop: Number(document.getElementById("cropTop").value),
        uiCropBottom: Number(document.getElementById("cropBottom").value),
        uiCropLeft: Number(document.getElementById("cropLeft").value),
        uiCropRight: Number(document.getElementById("cropRight").value),
      }),
    });
    currentAsset = data.asset;
    if (currentAsset.cleanedMediaUrl) {
      const player = document.getElementById("videoPlayer");
      player.src = currentAsset.cleanedMediaUrl + "?t=" + Date.now();
    }
    setMsg("uiMsg", "✅ UI除去完了", "ok");
  } catch (err) {
    setMsg("uiMsg", err.message, "err");
  } finally {
    btn.disabled = false;
  }
}

/* ===== Auto Clip ===== */
async function handleAutoClip() {
  if (!currentAsset) return;
  const btn = document.getElementById("autoClipBtn");
  btn.disabled = true;
  setMsg("clipMsg", "クリップ生成中...");

  const progress = document.getElementById("clipProgress");
  const bar = document.getElementById("clipProgressBar");
  progress.style.display = "block";
  bar.style.width = "0%";

  const timer = setInterval(() => {
    const current = parseInt(bar.style.width) || 0;
    if (current < 90) bar.style.width = (current + 3) + "%";
  }, 500);

  try {
    const data = await api(`/api/videos/assets/${currentAsset.id}/auto-clip`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clipDurationSec: Number(document.getElementById("clipDuration").value),
        maxClips: Number(document.getElementById("maxClips").value),
      }),
    });
    bar.style.width = "100%";
    renderClipGrid(data.clips);
    setMsg("clipMsg", `✅ ${data.clips.length}件のクリップを生成しました`, "ok");
  } catch (err) {
    setMsg("clipMsg", err.message, "err");
  } finally {
    clearInterval(timer);
    btn.disabled = false;
    setTimeout(() => { progress.style.display = "none"; }, 800);
  }
}

function renderClipGrid(clips) {
  const section = document.getElementById("clipSection");
  const grid = document.getElementById("clipGrid");
  section.style.display = "block";

  grid.innerHTML = clips.map((clip, i) => `
    <div class="clip-card${selectedClipId === clip.id ? " selected" : ""}" data-id="${esc(clip.id)}" data-preview="${esc(clip.previewUrl || "")}">
      ${clip.previewUrl ? `<video src="${esc(clip.previewUrl)}" muted playsinline preload="metadata"></video>` : `<div style="height:90px;background:#111;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px">動画なし</div>`}
      <div class="clip-label">クリップ${i + 1}</div>
    </div>
  `).join("");

  grid.querySelectorAll(".clip-card").forEach((card) => {
    card.addEventListener("click", () => {
      selectedClipId = card.dataset.id;
      grid.querySelectorAll(".clip-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      document.getElementById("toStep3Btn").disabled = false;
    });
  });
}

/* ===== Step 3: Draft generation ===== */
function activateStep3() {
  setDisabled("step3Card", false);
  updateStepBadges(3);
  window.scrollTo({ top: document.getElementById("step3Card").offsetTop - 20, behavior: "smooth" });
}

async function handleGenerateDrafts() {
  if (!currentJob) return;
  const btn = document.getElementById("generateBtn");
  btn.disabled = true;
  setMsg("generateMsg", "Claudeが投稿文を生成中...");

  try {
    const data = await api("/api/myfans/posts/generate-drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        affiliateJobId: currentJob.id,
        tone: document.getElementById("tone").value,
        variantCount: Number(document.getElementById("variantCount").value),
        clipId: selectedClipId || undefined,
      }),
    });
    currentDraftIds = (data.drafts || []).map((d) => d.id);
    renderDrafts(data.drafts || []);
    setMsg("generateMsg", `✅ ${data.drafts.length}件の投稿文を生成しました`, "ok");
    document.getElementById("draftsSection").style.display = "block";
  } catch (err) {
    setMsg("generateMsg", err.message, "err");
  } finally {
    btn.disabled = false;
  }
}

function renderDrafts(drafts) {
  const list = document.getElementById("draftsList");
  list.innerHTML = drafts.map((draft) => `
    <div class="draft-card" id="draft-${esc(draft.id)}">
      <pre class="draft-text">${esc(draft.text || "")}</pre>
      <div class="row" style="margin-top:8px">
        <button class="btn-gray btn-sm" onclick="copyDraft('${esc(draft.id)}')">📋 コピー</button>
        <button class="btn-green btn-sm" onclick="approveDraft('${esc(draft.id)}')">✅ 承認</button>
        <button class="btn-sm" style="background:#e8edf8;color:#c0392b" onclick="markPosted('${esc(draft.id)}')">📤 投稿済み</button>
      </div>
      <p class="msg" id="draftMsg-${esc(draft.id)}"></p>
    </div>
  `).join("");
}

async function copyDraft(draftId) {
  const card = document.getElementById(`draft-${draftId}`);
  const text = card?.querySelector(".draft-text")?.textContent || "";
  await navigator.clipboard.writeText(text).catch(() => {});
  setMsg(`draftMsg-${draftId}`, "✅ コピーしました", "ok");
}

async function approveDraft(draftId) {
  try {
    await api(`/api/myfans/posts/drafts/${draftId}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    setMsg(`draftMsg-${draftId}`, "✅ 承認済み", "ok");
  } catch (err) {
    setMsg(`draftMsg-${draftId}`, err.message, "err");
  }
}

async function markPosted(draftId) {
  try {
    await api(`/api/myfans/posts/drafts/${draftId}/mark-manually-posted`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    setMsg(`draftMsg-${draftId}`, "✅ 投稿済みにしました", "ok");
  } catch (err) {
    setMsg(`draftMsg-${draftId}`, err.message, "err");
  }
}

/* ===== History ===== */
async function refreshHistory() {
  try {
    const data = await api("/api/myfans/affiliate/jobs");
    const list = document.getElementById("historyList");
    const allJobs = [...(data.readyJobs || []), ...(data.jobs || [])];
    if (!allJobs.length) {
      list.innerHTML = "<p class='msg'>ジョブはまだありません。</p>";
      return;
    }
    const unique = [...new Map(allJobs.map((j) => [j.id, j])).values()];
    list.innerHTML = unique.slice(0, 20).map((job) => `
      <div class="history-item">
        <span class="badge${job.affiliateUrl ? " green" : ""}">${esc(job.status)}</span>
        <span style="font-size:12px;color:var(--muted)">${esc((job.sourceUrl || "").slice(0, 50))}</span>
        ${job.affiliateUrl ? `<div class="mono" style="margin-top:4px">${esc(job.affiliateUrl)}</div>` : ""}
        ${job.affiliateUrl ? `<div class="row" style="margin-top:6px"><button class="btn-primary btn-sm" onclick="loadJob('${esc(job.id)}')">このジョブで続ける</button></div>` : ""}
      </div>
    `).join("");
  } catch {
    /* ignore */
  }
}

async function loadJob(jobId) {
  try {
    const data = await api(`/api/myfans/affiliate/jobs/${jobId}`);
    currentJob = data.job;
    document.getElementById("sourceUrl").value = currentJob.sourceUrl || "";
    document.getElementById("affiliateUrl").value = currentJob.affiliateUrl || "";
    setMsg("step1Msg", `✅ ジョブを読み込みました (ID: ${currentJob.id.slice(0, 8)}...)`, "ok");
    setDisabled("step2Card", false);
    setDisabled("step3Card", false);
    updateStepBadges(2);
  } catch (err) {
    alert(err.message);
  }
}

/* ===== Init ===== */
function init() {
  initSliders();

  document.getElementById("createJobBtn").addEventListener("click", handleCreateJob);
  document.getElementById("registerVideoBtn").addEventListener("click", handleRegisterVideo);
  document.getElementById("applyUiBtn").addEventListener("click", handleApplyUi);
  document.getElementById("autoClipBtn").addEventListener("click", handleAutoClip);
  document.getElementById("generateBtn").addEventListener("click", handleGenerateDrafts);

  document.getElementById("toStep3Btn").addEventListener("click", activateStep3);
  document.getElementById("skipVideoBtn").addEventListener("click", () => {
    setDisabled("step3Card", false);
    updateStepBadges(3);
    window.scrollTo({ top: document.getElementById("step3Card").offsetTop - 20, behavior: "smooth" });
  });

  refreshHistory();
}

window.copyDraft = copyDraft;
window.approveDraft = approveDraft;
window.markPosted = markPosted;
window.loadJob = loadJob;

init();
