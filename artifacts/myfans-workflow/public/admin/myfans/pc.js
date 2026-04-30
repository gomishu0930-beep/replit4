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

function renderReadyJobs(readyJobs) {
  const root = document.getElementById("readyJobs");
  if (!readyJobs.length) {
    root.textContent = "投稿素材化できるjobはまだありません。";
    return;
  }

  root.innerHTML = readyJobs
    .map((job) => {
      const sourceUrl = escapeHtml(job.sourceUrl || "");
      const affiliateUrl = escapeHtml(job.affiliateUrl || "");
      const jobId = encodeURIComponent(job.id);
      return `
        <article class="job-item">
          <div><span class="badge">${escapeHtml(job.status)}</span><span class="badge">${escapeHtml(job.acquisitionMethod || "null")}</span></div>
          <div class="mono" style="margin-top:6px">source: ${sourceUrl}</div>
          <div class="mono" style="margin-top:6px">affiliate: ${affiliateUrl}</div>
          <div class="row" style="margin-top:8px">
            <a href="/admin/posts/create-with-clip/?affiliateJobId=${jobId}">この動画で投稿文生成</a>
            <a href="/admin/posts/drafts">投稿下書き一覧</a>
            <a href="/admin/myfans/post-review">投稿用レビュー</a>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderExcludedJobs(excludedJobs) {
  const root = document.getElementById("excludedJobs");
  if (!excludedJobs.length) {
    root.textContent = "投稿対象外jobはありません。";
    return;
  }
  root.innerHTML = excludedJobs
    .map((job) => {
      const sourceUrl = escapeHtml(job.sourceUrl || "");
      const errorMessage = escapeHtml(job.errorMessage || "");
      return `
        <article class="job-item excluded">
          <div><span class="badge">${escapeHtml(job.status)}</span><span class="badge">投稿対象外</span></div>
          <div class="mono" style="margin-top:6px">source: ${sourceUrl}</div>
          ${errorMessage ? `<div class="mono" style="margin-top:6px">error: ${errorMessage}</div>` : ""}
        </article>
      `;
    })
    .join("");
}

function renderWaitingJobs(waitingJobs) {
  const root = document.getElementById("waitingJobs");
  if (!waitingJobs.length) {
    root.textContent = "投稿文生成待ちjobはありません。";
    return;
  }
  root.innerHTML = waitingJobs
    .map((job) => {
      const sourceUrl = escapeHtml(job.sourceUrl || "");
      return `
        <article class="job-item">
          <div><span class="badge">${escapeHtml(job.status)}</span><span class="badge">生成待ち</span></div>
          <div class="mono" style="margin-top:6px">source: ${sourceUrl}</div>
          <div style="margin-top:6px">affiliateUrl保存後に生成できます</div>
        </article>
      `;
    })
    .join("");
}

async function refreshStats() {
  const body = await fetchJson("/api/myfans/affiliate/stats");
  document.getElementById("pendingManualCount").textContent = String(body.counts.pending_manual || 0);
  document.getElementById("doneManualCount").textContent = String(body.counts.done_manual || 0);
  document.getElementById("unsupportedUrlCount").textContent = String(body.counts.unsupported_url || 0);
  document.getElementById("affiliateDisabledCount").textContent = String(body.counts.affiliate_disabled || 0);
}

async function refreshJobPanels() {
  const body = await fetchJson("/api/myfans/affiliate/jobs");
  renderReadyJobs(body.readyJobs || []);
  renderExcludedJobs(body.excludedJobs || []);
  const waitingJobs = (body.jobs || []).filter((job) => !job.affiliateUrl && !["unsupported_url", "affiliate_disabled", "error"].includes(job.status));
  renderWaitingJobs(waitingJobs);
}

async function initPcPage() {
  const enqueueBtn = document.getElementById("enqueueBtn");
  const enqueueMsg = document.getElementById("enqueueMsg");
  const sourceUrlInput = document.getElementById("sourceUrl");
  const mobileUrl = document.getElementById("mobileUrl");
  const copyMobileUrlBtn = document.getElementById("copyMobileUrlBtn");

  const config = await fetchJson("/api/myfans/config");
  mobileUrl.textContent = config.mobilePageUrl;

  copyMobileUrlBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(config.mobilePageUrl);
    enqueueMsg.textContent = "スマホページURLをコピーしました。";
  });

  enqueueBtn.addEventListener("click", async () => {
    enqueueMsg.textContent = "";
    try {
      const sourceUrl = sourceUrlInput.value;
      await fetchJson("/api/myfans/affiliate/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceUrl }),
      });
      sourceUrlInput.value = "";
      enqueueMsg.textContent = "キューに追加しました。";
      await refreshStats();
      await refreshJobPanels();
    } catch (error) {
      enqueueMsg.textContent = error.message;
    }
  });

  await refreshStats();
  await refreshJobPanels();
}

initPcPage().catch((error) => {
  const enqueueMsg = document.getElementById("enqueueMsg");
  if (enqueueMsg) {
    enqueueMsg.textContent = error.message;
  }
});
