const { mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { createPostDraftsStore } = require("./post-drafts-store");

async function ensureFile(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, JSON.stringify({ drafts: [] }, null, 2));
  }
}

async function loadDrafts(filePath) {
  await ensureFile(filePath);
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.drafts) ? parsed.drafts : [];
}

async function saveDrafts(filePath, drafts) {
  await writeFile(filePath, JSON.stringify({ drafts }, null, 2));
}

async function createFileBackedPostDraftsStore(
  filePath,
  nowProvider = () => new Date().toISOString(),
) {
  const initialDrafts = await loadDrafts(filePath);
  const memory = createPostDraftsStore(initialDrafts, nowProvider);

  async function persistAndReturn(callback) {
    const result = callback();
    await saveDrafts(filePath, memory.listAll());
    return result;
  }

  return {
    async attachClip(payload) {
      return persistAndReturn(() => memory.attachClip(payload));
    },
    async createDraft(payload) {
      return persistAndReturn(() => memory.createDraft(payload));
    },
    async getById(id) {
      return memory.getById(id);
    },
    async list(filters) {
      return memory.list(filters || {});
    },
    async listAll() {
      return memory.listAll();
    },
    async markManuallyPosted(payload) {
      return persistAndReturn(() => memory.markManuallyPosted(payload));
    },
    async updateStatus(payload) {
      return persistAndReturn(() => memory.updateStatus(payload));
    },
  };
}

module.exports = {
  createFileBackedPostDraftsStore,
};
