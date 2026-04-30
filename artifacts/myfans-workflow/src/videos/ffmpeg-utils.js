const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

async function defaultRunCommand(command, args) {
  return execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 8 });
}

function createFfmpegTools(runCommand = defaultRunCommand) {
  async function ensureBinary(command) {
    try {
      await runCommand(command, ["-version"]);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`${command} is required but not installed. Install ffmpeg/ffprobe first.`);
      }
      throw error;
    }
  }

  async function ensureFfmpegAvailable() {
    await ensureBinary("ffmpeg");
    await ensureBinary("ffprobe");
  }

  async function probeVideoMetadata(filePath) {
    const { stdout } = await runCommand("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=width,height",
      "-of",
      "json",
      filePath,
    ]);

    const parsed = JSON.parse(stdout);
    const firstVideoStream = Array.isArray(parsed.streams)
      ? parsed.streams.find(
          (stream) => Number.isFinite(Number(stream.width)) && Number.isFinite(Number(stream.height)),
        )
      : null;
    const durationRaw = parsed?.format?.duration;

    return {
      durationSec: durationRaw == null ? null : Number(durationRaw),
      width: firstVideoStream ? Number(firstVideoStream.width) : null,
      height: firstVideoStream ? Number(firstVideoStream.height) : null,
    };
  }

  async function runCleanUiFfmpeg({ inputPath, outputPath, cropFilter }) {
    const args = [
      "-y",
      "-i",
      inputPath,
      "-vf",
      cropFilter,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      outputPath,
    ];
    await runCommand("ffmpeg", args);
    return { command: "ffmpeg", args };
  }

  async function createVideoClip({ inputPath, outputPath, startSec, durationSec }) {
    const args = [
      "-y",
      "-ss",
      String(startSec),
      "-i",
      inputPath,
      "-t",
      String(durationSec),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      outputPath,
    ];
    await runCommand("ffmpeg", args);
    return { command: "ffmpeg", args };
  }

  return {
    createVideoClip,
    ensureFfmpegAvailable,
    probeVideoMetadata,
    runCleanUiFfmpeg,
  };
}

function ensureNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}

function validateCropValues({ uiCropTop, uiCropBottom, uiCropLeft, uiCropRight }, width, height) {
  ensureNonNegativeInteger(uiCropTop, "uiCropTop");
  ensureNonNegativeInteger(uiCropBottom, "uiCropBottom");
  ensureNonNegativeInteger(uiCropLeft, "uiCropLeft");
  ensureNonNegativeInteger(uiCropRight, "uiCropRight");

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("Video width/height is not available.");
  }
  if (uiCropLeft + uiCropRight >= width) {
    throw new Error("Crop left/right exceeds video width.");
  }
  if (uiCropTop + uiCropBottom >= height) {
    throw new Error("Crop top/bottom exceeds video height.");
  }
}

function buildCropFilter({ uiCropTop, uiCropBottom, uiCropLeft, uiCropRight }) {
  return `crop=iw-${uiCropLeft}-${uiCropRight}:ih-${uiCropTop}-${uiCropBottom}:${uiCropLeft}:${uiCropTop}`;
}

module.exports = {
  buildCropFilter,
  createFfmpegTools,
  defaultRunCommand,
  validateCropValues,
};
