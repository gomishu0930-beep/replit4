const { mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { createVideoAssetsStore } = require("./video-assets-store");

async function ensureFile(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, JSON.stringify({ assets: [] }, null, 2));
  }
}

async function loadAssets(filePath) {
  await ensureFile(filePath);
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.assets) ? parsed.assets : [];
}

async function saveAssets(filePath, assets) {
  await writeFile(filePath, JSON.stringify({ assets }, null, 2));
}

async function createFileBackedVideoAssetsStore(
  filePath,
  nowProvider = () => new Date().toISOString(),
) {
  const initialAssets = await loadAssets(filePath);
  const memory = createVideoAssetsStore(initialAssets, nowProvider);

  async function persistAndReturn(callback) {
    const result = callback();
    await saveAssets(filePath, memory.listAll());
    return result;
  }

  return {
    async createUploadedAsset(payload) {
      return persistAndReturn(() => memory.createUploadedAsset(payload));
    },
    async getById(id) {
      return memory.getById(id);
    },
    async listAll() {
      return memory.listAll();
    },
    async markAnalyzed(payload) {
      return persistAndReturn(() => memory.markAnalyzed(payload));
    },
    async markCleaned(payload) {
      return persistAndReturn(() => memory.markCleaned(payload));
    },
    async markError(payload) {
      return persistAndReturn(() => memory.markError(payload));
    },
  };
}

module.exports = {
  createFileBackedVideoAssetsStore,
};
