const { randomUUID } = require("node:crypto");
const { VIDEO_STATUS } = require("./video-status");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createVideoAssetsStore(initialAssets = [], nowProvider = () => new Date().toISOString()) {
  const assets = [...initialAssets];

  function findRefById(id) {
    return assets.find((asset) => asset.id === id) || null;
  }

  function listAll() {
    return assets.map(clone);
  }

  function getById(id) {
    const ref = findRefById(id);
    return ref ? clone(ref) : null;
  }

  function createUploadedAsset({ filePath, originalFilename, rightsConfirmed }) {
    const now = nowProvider();
    const created = {
      id: randomUUID(),
      filePath,
      originalFilename,
      durationSec: null,
      width: null,
      height: null,
      status: VIDEO_STATUS.UPLOADED,
      rightsConfirmed: Boolean(rightsConfirmed),
      uiCropTop: 0,
      uiCropBottom: 0,
      uiCropLeft: 0,
      uiCropRight: 0,
      uiMasksJson: null,
      cleanedFilePath: null,
      cleanedAt: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    assets.push(created);
    return clone(created);
  }

  function markAnalyzed({ id, durationSec, width, height }) {
    const ref = findRefById(id);
    if (!ref) {
      return null;
    }
    ref.durationSec = durationSec ?? null;
    ref.width = width ?? null;
    ref.height = height ?? null;
    ref.status = VIDEO_STATUS.ANALYZED;
    ref.errorMessage = null;
    ref.updatedAt = nowProvider();
    return clone(ref);
  }

  function markCleaned({
    id,
    uiCropTop,
    uiCropBottom,
    uiCropLeft,
    uiCropRight,
    uiMasksJson,
    cleanedFilePath,
  }) {
    const ref = findRefById(id);
    if (!ref) {
      return null;
    }
    const now = nowProvider();
    ref.uiCropTop = uiCropTop;
    ref.uiCropBottom = uiCropBottom;
    ref.uiCropLeft = uiCropLeft;
    ref.uiCropRight = uiCropRight;
    ref.uiMasksJson = uiMasksJson ?? null;
    ref.cleanedFilePath = cleanedFilePath;
    ref.cleanedAt = now;
    ref.status = VIDEO_STATUS.CLEANED;
    ref.errorMessage = null;
    ref.updatedAt = now;
    return clone(ref);
  }

  function markError({ id, errorMessage }) {
    const ref = findRefById(id);
    if (!ref) {
      return null;
    }
    ref.status = VIDEO_STATUS.ERROR;
    ref.errorMessage = errorMessage;
    ref.updatedAt = nowProvider();
    return clone(ref);
  }

  return {
    createUploadedAsset,
    getById,
    listAll,
    markAnalyzed,
    markCleaned,
    markError,
  };
}

module.exports = {
  createVideoAssetsStore,
};
