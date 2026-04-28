import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getSafetyStatus } from "../bot/safety-engine.js";
import { getRunConfig } from "../bot/run-config.js";
import { getQueueStats } from "../bot/post-queue.js";
import { isBotPaused, getPausedReason } from "../bot/twitter.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/health", (_req, res) => {
  const safety = getSafetyStatus();
  const config = getRunConfig();
  const queueStats = getQueueStats();
  const paused = isBotPaused();

  res.json({
    status: paused ? "paused" : "ok",
    timestamp: new Date().toISOString(),
    bot: {
      paused,
      pausedReason: paused ? getPausedReason() : null,
      automationLevel: safety.automationLevel,
      riskScore: safety.riskScore,
      followerCount: safety.followerCount,
    },
    runConfig: {
      autoPostEnabled: config.autoPostEnabled,
      dryRun: config.dryRun,
      maxPostsPerDay: config.maxPostsPerDay,
    },
    todayStats: {
      posted: safety.todayPostCount,
      limit: safety.dailyPostLimit,
      remaining: safety.remainingPostsToday,
    },
    queue: queueStats,
  });
});

export default router;
