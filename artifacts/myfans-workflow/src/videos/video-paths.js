const path = require("node:path");

const RAW_VIDEOS_DIR = path.resolve(".uploads", "videos", "raw");
const CLEAN_VIDEOS_DIR = path.resolve(".generated", "videos", "clean");
const CLIPS_DIR = path.resolve(".generated", "clips");
const THUMBNAILS_DIR = path.resolve(".generated", "thumbnails");

const RAW_VIDEOS_RELATIVE_DIR = ".uploads/videos/raw";
const CLEAN_VIDEOS_RELATIVE_DIR = ".generated/videos/clean";
const CLIPS_RELATIVE_DIR = ".generated/clips";
const THUMBNAILS_RELATIVE_DIR = ".generated/thumbnails";

module.exports = {
  CLEAN_VIDEOS_DIR,
  CLEAN_VIDEOS_RELATIVE_DIR,
  CLIPS_DIR,
  CLIPS_RELATIVE_DIR,
  RAW_VIDEOS_DIR,
  RAW_VIDEOS_RELATIVE_DIR,
  THUMBNAILS_DIR,
  THUMBNAILS_RELATIVE_DIR,
};
