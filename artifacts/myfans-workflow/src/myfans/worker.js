const { TERMINAL_ERROR_CODES } = require("./types");

function shouldStopWorkerOnResult(result) {
  if (!result || result.status !== "error") {
    return false;
  }
  return TERMINAL_ERROR_CODES.has(result.errorCode);
}

function getManualFallbackRecommendation(result) {
  if (!result || result.status !== "error") {
    return null;
  }
  if (result.errorCode === "verification_required") {
    return "mobile_manual";
  }
  return null;
}

async function runWorkerQueue(options = {}) {
  const { jobs, runOne, onStop } = options;
  if (!Array.isArray(jobs)) {
    throw new Error("jobs must be an array");
  }
  if (typeof runOne !== "function") {
    throw new Error("runOne must be a function");
  }

  const results = [];
  for (const job of jobs) {
    const result = await runOne(job);
    results.push(result);

    if (shouldStopWorkerOnResult(result)) {
      if (typeof onStop === "function") {
        onStop({ reason: result.errorCode, result });
      }
      break;
    }
  }

  return results;
}

module.exports = {
  getManualFallbackRecommendation,
  runWorkerQueue,
  shouldStopWorkerOnResult,
};
