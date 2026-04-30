const { randomUUID } = require("node:crypto");
const { JOB_STATUS } = require("./job-status");

function sortByCreatedAtAsc(a, b) {
  const left = new Date(a.createdAt).getTime();
  const right = new Date(b.createdAt).getTime();
  return left - right;
}

function createMyfansJobsStore(initialJobs = [], nowProvider = () => new Date().toISOString()) {
  const jobs = [...initialJobs];

  function serialize(job) {
    return { ...job };
  }

  function findById(id) {
    return jobs.find((job) => job.id === id) || null;
  }

  function isReadyStatus(status) {
    return status === JOB_STATUS.DONE || status === JOB_STATUS.DONE_MANUAL;
  }

  function hasAffiliateUrl(job) {
    return Boolean((job?.affiliateUrl || "").trim());
  }

  function enqueue({ sourceUrl, status = JOB_STATUS.QUEUED, acquisitionMethod = null }) {
    const now = nowProvider();
    const created = {
      id: randomUUID(),
      sourceUrl,
      status,
      acquisitionMethod,
      affiliateUrl: null,
      errorCode: null,
      errorMessage: null,
      manualStartedAt: null,
      processedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    jobs.push(created);
    return serialize(created);
  }

  function listAll() {
    return jobs.map(serialize);
  }

  function claimNextManualJob() {
    const candidates = jobs
      .filter(
        (job) => job.status === JOB_STATUS.QUEUED || job.status === JOB_STATUS.PENDING_MANUAL,
      )
      .sort(sortByCreatedAtAsc);

    const picked = candidates[0];
    if (!picked) {
      return null;
    }

    const now = nowProvider();
    picked.status = JOB_STATUS.PENDING_MANUAL;
    picked.acquisitionMethod = "mobile_manual";
    picked.manualStartedAt = picked.manualStartedAt || now;
    picked.updatedAt = now;
    return serialize(picked);
  }

  function markManualDone({ id, affiliateUrl }) {
    const job = findById(id);
    if (!job) {
      return null;
    }
    const now = nowProvider();
    job.status = JOB_STATUS.DONE_MANUAL;
    job.acquisitionMethod = "mobile_manual";
    job.affiliateUrl = affiliateUrl;
    job.errorCode = null;
    job.errorMessage = null;
    job.processedAt = now;
    job.updatedAt = now;
    return serialize(job);
  }

  function skipManual({ id, reason, errorMessage = null }) {
    const job = findById(id);
    if (!job) {
      return null;
    }
    const now = nowProvider();
    job.status = reason;
    job.acquisitionMethod = "mobile_manual";
    job.errorCode = reason;
    job.errorMessage = errorMessage;
    job.processedAt = now;
    job.updatedAt = now;
    return serialize(job);
  }

  function getAffiliateJobById(id) {
    const found = findById(id);
    return found ? serialize(found) : null;
  }

  function listReadyAffiliateJobs() {
    return jobs
      .filter((job) => isReadyStatus(job.status) && hasAffiliateUrl(job))
      .sort(sortByCreatedAtAsc)
      .map(serialize);
  }

  function assertAffiliateJobReadyForPostGeneration(id) {
    const job = findById(id);
    if (!job) {
      throw new Error("Affiliate job not found.");
    }
    if (!hasAffiliateUrl(job)) {
      throw new Error("Affiliate URL is not generated yet.");
    }
    if (!isReadyStatus(job.status)) {
      throw new Error(`Job status ${job.status} is not eligible for post generation.`);
    }
    return serialize(job);
  }

  function countsByStatus() {
    const counts = {};
    for (const job of jobs) {
      counts[job.status] = (counts[job.status] || 0) + 1;
    }
    return counts;
  }

  return {
    claimNextManualJob,
    countsByStatus,
    enqueue,
    getAffiliateJobById,
    assertAffiliateJobReadyForPostGeneration,
    findById: (id) => {
      const found = findById(id);
      return found ? serialize(found) : null;
    },
    listReadyAffiliateJobs,
    listAll,
    markManualDone,
    skipManual,
  };
}

module.exports = {
  createMyfansJobsStore,
};
