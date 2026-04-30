const path = require("node:path");
const { createFileBackedClipsStore } = require("../clips/file-clips-store");
const { createFileBackedJobsStore } = require("../myfans/file-jobs-store");
const { createFileBackedPostDraftsStore } = require("../posts/file-post-drafts-store");
const { createFileBackedVideoAssetsStore } = require("../videos/file-video-assets-store");
const { createApp, DEFAULT_GENERATOR_URL } = require("./app");

async function main() {
  const port = Number(process.env.PORT || 3100);
  const generatorUrl = process.env.MYFANS_AFFILIATE_GENERATOR_URL || DEFAULT_GENERATOR_URL;
  const dbPath =
    process.env.MYFANS_JOBS_DB_PATH || path.resolve(".local", "myfans-affiliate-jobs.json");
  const videoAssetsDbPath =
    process.env.VIDEO_ASSETS_DB_PATH || path.resolve(".local", "video-assets.json");
  const postDraftsDbPath =
    process.env.POST_DRAFTS_DB_PATH || path.resolve(".local", "post-drafts.json");
  const clipsDbPath = process.env.CLIPS_DB_PATH || path.resolve(".local", "clips.json");

  const store = await createFileBackedJobsStore(dbPath);
  const videoStore = await createFileBackedVideoAssetsStore(videoAssetsDbPath);
  const postDraftStore = await createFileBackedPostDraftsStore(postDraftsDbPath);
  const clipStore = await createFileBackedClipsStore(clipsDbPath);
  const app = createApp({ store, videoStore, postDraftStore, clipStore, generatorUrl });

  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
