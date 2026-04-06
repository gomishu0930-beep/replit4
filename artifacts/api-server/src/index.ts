import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./bot/scheduler";
import { initStorage } from "./bot/storage";
import { loadMeetingData } from "./bot/meeting";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // GCS からデータをロードしてからスケジューラーを起動
  await initStorage();
  await loadMeetingData();
  startScheduler();
});

// グレースフルシャットダウン：投稿中でも最大60秒待ってから終了
function gracefulShutdown(signal: string) {
  logger.info(`${signal} received — graceful shutdown started`);
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
  // 60秒以内に終わらなければ強制終了
  setTimeout(() => {
    logger.warn("Graceful shutdown timeout — forcing exit");
    process.exit(1);
  }, 60_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));

// 未処理のPromise拒否をキャッチ → クラッシュ防止
process.on("unhandledRejection", (reason: any) => {
  logger.error({ reason }, "unhandledRejection — 継続運転します");
});
process.on("uncaughtException", (err: Error) => {
  logger.error({ err }, "uncaughtException — 継続運転します");
});
