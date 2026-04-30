const { copyFile, mkdir } = require("node:fs/promises");
const path = require("node:path");
const { buildCropFilter, createFfmpegTools, validateCropValues } = require("./ffmpeg-utils");
const {
  CLEAN_VIDEOS_DIR,
  CLEAN_VIDEOS_RELATIVE_DIR,
  RAW_VIDEOS_DIR,
  RAW_VIDEOS_RELATIVE_DIR,
} = require("./video-paths");

function sanitizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function ensureRightsConfirmed(value) {
  if (value !== true) {
    throw Object.assign(new Error("rightsConfirmed must be true. Rights-cleared material only."), {
      statusCode: 400,
    });
  }
}

function toRelativeRawPath(savedName) {
  return path.posix.join(RAW_VIDEOS_RELATIVE_DIR, savedName);
}

function toRelativeCleanPath(savedName) {
  return path.posix.join(CLEAN_VIDEOS_RELATIVE_DIR, savedName);
}

function toAbsolutePathFromRelative(relativePath) {
  return path.resolve(relativePath);
}

function createVideoService(ffmpegTools = createFfmpegTools()) {
  async function registerLocalVideoAsset({ store, filePath, rightsConfirmed }) {
    ensureRightsConfirmed(rightsConfirmed);
    await ffmpegTools.ensureFfmpegAvailable();
    await mkdir(RAW_VIDEOS_DIR, { recursive: true });

    const originalFilename = path.basename(filePath);
    const extension = path.extname(originalFilename) || ".mp4";
    const base = path.basename(originalFilename, extension);
    const safeName = `${Date.now()}-${sanitizeFilename(base)}${extension}`;

    const relativeRawPath = toRelativeRawPath(safeName);
    const absoluteRawPath = toAbsolutePathFromRelative(relativeRawPath);

    const asset = await store.createUploadedAsset({
      filePath: relativeRawPath,
      originalFilename,
      rightsConfirmed: true,
    });

    try {
      await copyFile(filePath, absoluteRawPath);
      const metadata = await ffmpegTools.probeVideoMetadata(absoluteRawPath);
      return store.markAnalyzed({
        id: asset.id,
        durationSec: metadata.durationSec,
        width: metadata.width,
        height: metadata.height,
      });
    } catch (error) {
      await store.markError({ id: asset.id, errorMessage: error.message });
      throw error;
    }
  }

  async function cleanVideoUi({
    store,
    id,
    uiCropTop,
    uiCropBottom,
    uiCropLeft,
    uiCropRight,
    uiMasks,
  }) {
    const asset = await store.getById(id);
    if (!asset) {
      throw Object.assign(new Error("Video asset not found."), { statusCode: 404 });
    }
    if (asset.rightsConfirmed !== true) {
      throw Object.assign(new Error("rightsConfirmed=true asset only."), { statusCode: 400 });
    }

    await ffmpegTools.ensureFfmpegAvailable();

    const inputPath = toAbsolutePathFromRelative(asset.filePath);
    const width = Number(asset.width);
    const height = Number(asset.height);

    validateCropValues({ uiCropTop, uiCropBottom, uiCropLeft, uiCropRight }, width, height);

    await mkdir(CLEAN_VIDEOS_DIR, { recursive: true });
    const outputName = `${asset.id}-clean.mp4`;
    const relativeCleanPath = toRelativeCleanPath(outputName);
    const outputPath = toAbsolutePathFromRelative(relativeCleanPath);
    const cropFilter = buildCropFilter({ uiCropTop, uiCropBottom, uiCropLeft, uiCropRight });

    try {
      await ffmpegTools.runCleanUiFfmpeg({
        inputPath,
        outputPath,
        cropFilter,
      });
      return store.markCleaned({
        id,
        uiCropTop,
        uiCropBottom,
        uiCropLeft,
        uiCropRight,
        uiMasksJson: uiMasks == null ? null : JSON.stringify(uiMasks),
        cleanedFilePath: relativeCleanPath,
      });
    } catch (error) {
      await store.markError({ id, errorMessage: error.message });
      throw error;
    }
  }

  return {
    cleanVideoUi,
    registerLocalVideoAsset,
  };
}

const defaultVideoService = createVideoService();

module.exports = {
  cleanVideoUi: defaultVideoService.cleanVideoUi,
  createVideoService,
  registerLocalVideoAsset: defaultVideoService.registerLocalVideoAsset,
};
