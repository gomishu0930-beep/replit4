let currentJob = null;
let generatorUrl = "https://www.affiliate.myfans.jp/affiliates/url";

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return body;
}

function setMessage(message) {
  const msg = document.getElementById("msg");
  msg.textContent = message;
}

function renderJob() {
  const sourceUrlNode = document.getElementById("sourceUrl");
  const affiliateInput = document.getElementById("affiliateUrl");

  if (!currentJob) {
    sourceUrlNode.textContent = "処理対象ジョブはありません。";
    affiliateInput.value = "";
    return;
  }

  sourceUrlNode.textContent = currentJob.sourceUrl;
  affiliateInput.value = "";
}

async function loadNextJob() {
  const body = await fetchJson("/api/myfans/affiliate/mobile/next");
  currentJob = body.job;
  renderJob();
}

async function postResult() {
  if (!currentJob) {
    setMessage("処理対象がありません。");
    return;
  }
  const affiliateUrl = document.getElementById("affiliateUrl").value;
  const body = await fetchJson("/api/myfans/affiliate/mobile/result", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: currentJob.id,
      affiliateUrl,
    }),
  });

  if (body.warning) {
    setMessage(`保存しました（注意: ${body.warning}）。次のジョブを読み込みます。`);
  } else {
    setMessage("保存しました。次のジョブを読み込みます。");
  }
  await loadNextJob();
}

async function skipCurrent(reason) {
  if (!currentJob) {
    setMessage("処理対象がありません。");
    return;
  }
  await fetchJson("/api/myfans/affiliate/mobile/skip", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: currentJob.id,
      reason,
    }),
  });
  setMessage("スキップとして保存しました。次のジョブを読み込みます。");
  await loadNextJob();
}

async function init() {
  const config = await fetchJson("/api/myfans/config");
  generatorUrl = config.generatorUrl || generatorUrl;

  document.getElementById("copySourceBtn").addEventListener("click", async () => {
    if (!currentJob) {
      setMessage("処理対象がありません。");
      return;
    }
    await navigator.clipboard.writeText(currentJob.sourceUrl);
    setMessage("元URLをコピーしました。");
  });

  document.getElementById("openGeneratorBtn").addEventListener("click", () => {
    window.open(generatorUrl, "_blank", "noopener,noreferrer");
  });

  document.getElementById("saveNextBtn").addEventListener("click", async () => {
    try {
      await postResult();
    } catch (error) {
      setMessage(error.message);
    }
  });

  document.getElementById("skipUnsupportedBtn").addEventListener("click", async () => {
    try {
      await skipCurrent("unsupported_url");
    } catch (error) {
      setMessage(error.message);
    }
  });

  document.getElementById("skipDisabledBtn").addEventListener("click", async () => {
    try {
      await skipCurrent("affiliate_disabled");
    } catch (error) {
      setMessage(error.message);
    }
  });

  document.getElementById("skipErrorBtn").addEventListener("click", async () => {
    try {
      await skipCurrent("error");
    } catch (error) {
      setMessage(error.message);
    }
  });

  await loadNextJob();
}

init().catch((error) => {
  setMessage(error.message);
});
