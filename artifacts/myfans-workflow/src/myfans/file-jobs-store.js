const { readFile, mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { createMyfansJobsStore } = require("./jobs-store");

async function ensureFile(dbFilePath) {
  await mkdir(path.dirname(dbFilePath), { recursive: true });
  try {
    await readFile(dbFilePath, "utf8");
  } catch {
    await writeFile(dbFilePath, JSON.stringify({ jobs: [] }, null, 2));
  }
}

async function loadJobs(dbFilePath) {
  await ensureFile(dbFilePath);
  const raw = await readFile(dbFilePath, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.jobs) ? parsed.jobs : [];
}

async function saveJobs(dbFilePath, jobs) {
  await writeFile(dbFilePath, JSON.stringify({ jobs }, null, 2));
}

async function createFileBackedJobsStore(dbFilePath, nowProvider = () => new Date().toISOString()) {
  const jobs = await loadJobs(dbFilePath);
  const memory = createMyfansJobsStore(jobs, nowProvider);

  async function persistAndReturn(fn) {
    const result = fn();
    await saveJobs(dbFilePath, memory.listAll());
    return result;
  }

  return {
    async assertAffiliateJobReadyForPostGeneration(id) {
      return memory.assertAffiliateJobReadyForPostGeneration(id);
    },
    async claimNextManualJob() {
      return persistAndReturn(() => memory.claimNextManualJob());
    },
    async countsByStatus() {
      return memory.countsByStatus();
    },
    async enqueue(payload) {
      return persistAndReturn(() => memory.enqueue(payload));
    },
    async findById(id) {
      return memory.findById(id);
    },
    async getAffiliateJobById(id) {
      return memory.getAffiliateJobById(id);
    },
    async listAll() {
      return memory.listAll();
    },
    async listReadyAffiliateJobs() {
      return memory.listReadyAffiliateJobs();
    },
    async markManualDone(payload) {
      return persistAndReturn(() => memory.markManualDone(payload));
    },
    async skipManual(payload) {
      return persistAndReturn(() => memory.skipManual(payload));
    },
  };
}

module.exports = {
  createFileBackedJobsStore,
};
