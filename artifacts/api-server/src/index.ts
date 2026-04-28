import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./bot/scheduler";
import { initStorage } from "./bot/storage";
import { loadMeetingData } from "./bot/meeting";
import { initTasks } from "./bot/tasks";
import { loadPauseState } from "./bot/twitter";
import { loadSafetyState } from "./bot/safety-engine";
import { loadRunConfig } from "./bot/run-config";
import { loadQueue } from "./bot/post-queue";

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

  await initStorage();
  await loadMeetingData();
  await initTasks();
  await loadPauseState();
  loadSafetyState();
  loadRunConfig();
  loadQueue();
  startScheduler();
});

function gracefulShutdown(signal: string) {
  logger.info(`${signal} received — graceful shutdown started`);
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn("Graceful shutdown timeout — forcing exit");
    process.exit(1);
  }, 60_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));

process.on("unhandledRejection", (reason: any) => {
  logger.error({ reason }, "unhandledRejection — 継続運転します");
});
process.on("uncaughtException", (err: Error) => {
  logger.error({ err }, "uncaughtException — 継続運転します");
});
