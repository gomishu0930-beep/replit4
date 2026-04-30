const { mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { createClipsStore } = require("./clips-store");

async function ensureFile(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, JSON.stringify({ clips: [] }, null, 2));
  }
}

async function loadClips(filePath) {
  await ensureFile(filePath);
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.clips) ? parsed.clips : [];
}

async function saveClips(filePath, clips) {
  await writeFile(filePath, JSON.stringify({ clips }, null, 2));
}

async function createFileBackedClipsStore(filePath, nowProvider = () => new Date().toISOString()) {
  const initialClips = await loadClips(filePath);
  const memory = createClipsStore(initialClips, nowProvider);

  async function persistAndReturn(callback) {
    const result = callback();
    await saveClips(filePath, memory.listAll());
    return result;
  }

  return {
    async createClip(payload) {
      return persistAndReturn(() => memory.createClip(payload));
    },
    async getById(id) {
      return memory.getById(id);
    },
    async listAll() {
      return memory.listAll();
    },
  };
}

module.exports = {
  createFileBackedClipsStore,
};
