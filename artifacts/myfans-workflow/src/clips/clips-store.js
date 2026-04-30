const { randomUUID } = require("node:crypto");

const CLIP_STATUS = Object.freeze({
  GENERATED: "generated",
  APPROVED: "approved",
  REJECTED: "rejected",
  ERROR: "error",
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createClipsStore(initialClips = [], nowProvider = () => new Date().toISOString()) {
  const clips = [...initialClips];

  function getByIdRef(id) {
    return clips.find((clip) => clip.id === id) || null;
  }

  function listAll() {
    return clips.map(clone);
  }

  function getById(id) {
    const ref = getByIdRef(id);
    return ref ? clone(ref) : null;
  }

  function createClip({
    filePath,
    outputPath = null,
    sourceType = "clean",
    sourceVideoAssetId = null,
    status,
  }) {
    const resolvedStatus = status || CLIP_STATUS.GENERATED;
    const now = nowProvider();
    const created = {
      id: randomUUID(),
      filePath,
      outputPath: outputPath || filePath,
      sourceType,
      sourceVideoAssetId,
      status: resolvedStatus,
      createdAt: now,
      updatedAt: now,
    };
    clips.push(created);
    return clone(created);
  }

  return {
    createClip,
    getById,
    listAll,
  };
}

module.exports = {
  CLIP_STATUS,
  createClipsStore,
};
