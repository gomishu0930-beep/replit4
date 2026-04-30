const path = require("node:path");
const express = require("express");
const {
  createGenerateMyfansPostsService,
  isAuthorizedRequest,
} = require("../claude/generate-myfans-posts");
const { JOB_STATUS, MOBILE_SKIP_REASONS } = require("../myfans/job-status");
const { POST_DRAFT_PLATFORM, POST_DRAFT_STATUS } = require("../posts/post-drafts-store");
const { isClipUsableForDraft, isDraftPostReady } = require("../posts/post-material-rules");
const { validateDraftText } = require("../posts/post-draft-validation");
const { createReplitClaudeClient } = require("../post-generation/replitClaudeClient");
const { validateAffiliateUrl, validateSourceUrl } = require("../myfans/validation");
const { cleanVideoUi, registerLocalVideoAsset } = require("../videos/video-service");
const {
  CLEAN_VIDEOS_RELATIVE_DIR,
  CLIPS_RELATIVE_DIR,
  RAW_VIDEOS_RELATIVE_DIR,
  THUMBNAILS_RELATIVE_DIR,
} = require("../videos/video-paths");

const DEFAULT_GENERATOR_URL = "https://www.affiliate.myfans.jp/affiliates/url";

function toApiJob(job) {
  if (!job) {
    return null;
  }
  return {
    id: job.id,
    sourceUrl: job.sourceUrl,
    status: job.status,
    acquisitionMethod: job.acquisitionMethod,
    affiliateUrl: job.affiliateUrl,
    errorCode: job.errorCode || null,
    manualStartedAt: job.manualStartedAt,
    processedAt: job.processedAt,
    errorMessage: job.errorMessage,
  };
}

function toMediaUrl(relativePath) {
  if (!relativePath) {
    return null;
  }
  const normalized = String(relativePath).replaceAll("\\", "/");
  if (normalized.startsWith(`${RAW_VIDEOS_RELATIVE_DIR}/`)) {
    return `/media/raw/${normalized.slice(`${RAW_VIDEOS_RELATIVE_DIR}/`.length)}`;
  }
  if (normalized.startsWith(`${CLEAN_VIDEOS_RELATIVE_DIR}/`)) {
    return `/media/clean/${normalized.slice(`${CLEAN_VIDEOS_RELATIVE_DIR}/`.length)}`;
  }
  if (normalized.startsWith(`${CLIPS_RELATIVE_DIR}/`)) {
    return `/media/clips/${normalized.slice(`${CLIPS_RELATIVE_DIR}/`.length)}`;
  }
  if (normalized.startsWith(`${THUMBNAILS_RELATIVE_DIR}/`)) {
    return `/media/thumbnails/${normalized.slice(`${THUMBNAILS_RELATIVE_DIR}/`.length)}`;
  }
  return null;
}

function toApiVideoAsset(asset) {
  if (!asset) {
    return null;
  }
  return {
    id: asset.id,
    filePath: asset.filePath,
    originalFilename: asset.originalFilename,
    durationSec: asset.durationSec,
    width: asset.width,
    height: asset.height,
    status: asset.status,
    rightsConfirmed: asset.rightsConfirmed,
    uiCropTop: asset.uiCropTop,
    uiCropBottom: asset.uiCropBottom,
    uiCropLeft: asset.uiCropLeft,
    uiCropRight: asset.uiCropRight,
    uiMasksJson: asset.uiMasksJson,
    cleanedFilePath: asset.cleanedFilePath,
    cleanedAt: asset.cleanedAt,
    errorMessage: asset.errorMessage,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    rawPreviewUrl: toMediaUrl(asset.filePath),
    cleanPreviewUrl: toMediaUrl(asset.cleanedFilePath),
  };
}

function toApiClip(clip) {
  if (!clip) {
    return null;
  }
  return {
    id: clip.id,
    filePath: clip.filePath,
    outputPath: clip.outputPath || clip.filePath,
    sourceType: clip.sourceType || null,
    sourceVideoAssetId: clip.sourceVideoAssetId || null,
    status: clip.status,
    previewUrl: toMediaUrl(clip.outputPath || clip.filePath),
    createdAt: clip.createdAt,
    updatedAt: clip.updatedAt,
  };
}

function toApiPostDraft(draft, clip = null, affiliateJob = null) {
  if (!draft) {
    return null;
  }
  return {
    id: draft.id,
    affiliateJobId: draft.affiliateJobId,
    clipId: draft.clipId,
    platform: draft.platform,
    text: draft.text,
    affiliateUrl: draft.affiliateUrl,
    hashtagsJson: draft.hashtagsJson,
    status: draft.status,
    generatedBy: draft.generatedBy,
    generationPromptVersion: draft.generationPromptVersion,
    generationProviderResponseId: draft.generationProviderResponseId,
    xPostId: draft.xPostId,
    xMediaId: draft.xMediaId,
    scheduledAt: draft.scheduledAt,
    postedAt: draft.postedAt,
    manualPostNote: draft.manualPostNote || null,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    clip: toApiClip(clip),
    affiliateJob: toApiJob(affiliateJob),
    postReady: isDraftPostReady(draft, clip),
  };
}

function requireString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    return `${fieldName} is required.`;
  }
  return null;
}

function parseRightsConfirmed(value) {
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  return null;
}

function parseCropInt(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function parseLimit(value) {
  if (value == null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseHasClip(value) {
  if (value == null || value === "") {
    return undefined;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return undefined;
}

function parseVariantCount(value) {
  if (value == null) {
    return 3;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    throw new Error("variantCount must be an integer between 1 and 10.");
  }
  return parsed;
}

function parseBooleanEnv(value, defaultValue) {
  if (value == null || value === "") {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return defaultValue;
}

function createApp(options = {}) {
  const replitClaudeClient = createReplitClaudeClient();
  const {
    store,
    videoStore = null,
    postDraftStore = null,
    clipStore = null,
    generatorUrl = DEFAULT_GENERATOR_URL,
    runtimeEnv = process.env,
    claudeOps = {
      generateMyfansPosts: createGenerateMyfansPostsService(),
    },
    videoOps = { cleanVideoUi, registerLocalVideoAsset },
    postGenerationOps = {
      async generateDrafts(payload) {
        const provider = String(runtimeEnv.POST_GENERATION_PROVIDER || "claude_replit").trim();
        if (provider !== "claude_replit") {
          throw Object.assign(new Error(`Unsupported POST_GENERATION_PROVIDER: ${provider}`), {
            statusCode: 500,
          });
        }

        const timeoutMsRaw = Number(runtimeEnv.POST_GENERATION_TIMEOUT_MS || 30000);
        const timeoutMs =
          Number.isInteger(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 30000;

        return replitClaudeClient.generateMyfansPostDrafts(
          {
            affiliateUrl: payload.affiliateUrl,
            tone: payload.tone,
            variantCount: payload.variantCount,
            platform: "x",
            contentHints: payload.contentHints || {},
            rules: {
              requirePrLabel: true,
              maxLength: payload.maxLength,
              ngWords: payload.ngWords || [],
            },
          },
          {
            baseUrl: runtimeEnv.REPLIT_CLAUDE_API_BASE_URL,
            token: runtimeEnv.REPLIT_CLAUDE_API_TOKEN || "",
            timeoutMs,
          },
        );
      },
      templateFallbackDrafts(payload) {
        const templates = [
          `#PR\n\n気になる人はこちら👇\n${payload.affiliateUrl}`,
          `#PR\n\n詳細はこちら👇\n${payload.affiliateUrl}`,
          `#PR\n\nチェックする方はこちら\n${payload.affiliateUrl}`,
          `#PR\n\nリンクはこちら👇\n${payload.affiliateUrl}`,
          `#PR\n\n気になったらこちら\n${payload.affiliateUrl}`,
        ];
        const drafts = [];
        for (let index = 0; index < payload.variantCount; index += 1) {
          drafts.push({ text: templates[index % templates.length] });
        }
        return {
          drafts,
          responseId: "template-fallback",
        };
      },
      isTemplateFallbackEnabled() {
        return parseBooleanEnv(runtimeEnv.POST_GENERATION_TEMPLATE_FALLBACK, false);
      },
      promptVersion() {
        return "replit-claude-v1";
      },
      providerName() {
        return "claude_replit";
      },
      maxLength() {
        return 250;
      },
      ngWords() {
        return [];
      },
      contentHints() {
        return {};
      },
      isDraftTextValid({ text, affiliateUrl, maxLength, ngWords }) {
        const validation = validateDraftText({
          text,
          affiliateUrl,
          maxLength,
          ngWords,
        });
        return validation;
      },
    },
  } = options;
  if (!store) {
    throw new Error("store is required");
  }
  if (!videoStore) {
    throw new Error("videoStore is required");
  }
  if (!postDraftStore) {
    throw new Error("postDraftStore is required");
  }
  if (!clipStore) {
    throw new Error("clipStore is required");
  }

  const app = express();
  app.use(express.json());
  app.use(express.static(path.resolve("public")));
  app.use(
    "/media/raw",
    express.static(path.resolve(".uploads", "videos", "raw"), { dotfiles: "allow" }),
  );
  app.use(
    "/media/clean",
    express.static(path.resolve(".generated", "videos", "clean"), { dotfiles: "allow" }),
  );
  app.use(
    "/media/clips",
    express.static(path.resolve(".generated", "clips"), { dotfiles: "allow" }),
  );
  app.use(
    "/media/thumbnails",
    express.static(path.resolve(".generated", "thumbnails"), { dotfiles: "allow" }),
  );

  app.get("/api/myfans/config", (req, res) => {
    const origin = `${req.protocol}://${req.get("host")}`;
    res.json({
      generatorUrl,
      mobilePageUrl: `${origin}/admin/myfans/mobile`,
      draftsPageUrl: `${origin}/admin/posts/drafts`,
      postReviewPageUrl: `${origin}/admin/myfans/post-review`,
    });
  });

  app.post("/api/claude/generate-myfans-posts", async (req, res) => {
    const requiredToken = String(runtimeEnv.REPLIT_CLAUDE_API_TOKEN || "").trim();
    const authorizationHeader = req.get("authorization");
    if (!isAuthorizedRequest(authorizationHeader, requiredToken)) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    try {
      const result = await claudeOps.generateMyfansPosts({
        payload: req.body,
        env: runtimeEnv,
      });
      return res.json(result);
    } catch (error) {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      return res.status(statusCode).json({ error: error.message || "Failed to generate posts." });
    }
  });

  app.post("/api/myfans/affiliate/jobs", async (req, res) => {
    const sourceCheck = validateSourceUrl(req.body?.sourceUrl);
    if (!sourceCheck.ok) {
      return res.status(400).json({ error: sourceCheck.message });
    }

    const created = await store.enqueue({
      sourceUrl: sourceCheck.value,
      status: JOB_STATUS.QUEUED,
      acquisitionMethod: "mobile_manual",
    });
    return res.status(201).json({ job: toApiJob(created) });
  });

  app.get("/api/myfans/affiliate/mobile/next", async (_req, res) => {
    const job = await store.claimNextManualJob();
    return res.json({
      job: job
        ? {
            id: job.id,
            sourceUrl: job.sourceUrl,
          }
        : null,
    });
  });

  app.get("/api/myfans/affiliate/jobs/ready", async (_req, res) => {
    const readyJobs = await store.listReadyAffiliateJobs();
    return res.json({
      jobs: readyJobs.map(toApiJob),
    });
  });

  app.get("/api/myfans/affiliate/jobs/:id", async (req, res) => {
    const job = await store.getAffiliateJobById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Affiliate job not found." });
    }
    return res.json({ job: toApiJob(job) });
  });

  app.get("/api/myfans/affiliate/jobs", async (_req, res) => {
    const jobs = await store.listAll();
    const excludedStatuses = new Set([
      JOB_STATUS.UNSUPPORTED_URL,
      JOB_STATUS.AFFILIATE_DISABLED,
      JOB_STATUS.ERROR,
    ]);

    const readyJobs = jobs.filter(
      (job) =>
        (job.status === JOB_STATUS.DONE || job.status === JOB_STATUS.DONE_MANUAL) &&
        Boolean((job.affiliateUrl || "").trim()),
    );
    const excludedJobs = jobs.filter((job) => excludedStatuses.has(job.status));

    return res.json({
      jobs: jobs.map(toApiJob),
      readyJobs: readyJobs.map(toApiJob),
      excludedJobs: excludedJobs.map(toApiJob),
    });
  });

  app.post("/api/myfans/affiliate/mobile/result", async (req, res) => {
    const idError = requireString(req.body?.id, "id");
    if (idError) {
      return res.status(400).json({ error: idError });
    }

    const affiliateCheck = validateAffiliateUrl(req.body?.affiliateUrl);
    if (!affiliateCheck.ok) {
      return res.status(400).json({ error: affiliateCheck.message });
    }

    const existing = await store.findById(req.body.id);
    if (!existing) {
      return res.status(404).json({ error: "Job not found." });
    }

    const updated = await store.markManualDone({
      id: req.body.id,
      affiliateUrl: affiliateCheck.value,
    });

    const warning = affiliateCheck.hasAffiliateHint
      ? null
      : "affiliateUrl does not include common affiliate markers (myfans/affiliate/aff/referral).";

    return res.json({
      job: toApiJob(updated),
      warning,
    });
  });

  app.post("/api/myfans/affiliate/mobile/skip", async (req, res) => {
    const idError = requireString(req.body?.id, "id");
    if (idError) {
      return res.status(400).json({ error: idError });
    }

    const reason = req.body?.reason;
    if (!MOBILE_SKIP_REASONS.has(reason)) {
      return res
        .status(400)
        .json({ error: "reason must be unsupported_url, affiliate_disabled, or error." });
    }

    const existing = await store.findById(req.body.id);
    if (!existing) {
      return res.status(404).json({ error: "Job not found." });
    }

    const updated = await store.skipManual({
      id: req.body.id,
      reason,
      errorMessage: req.body?.errorMessage || null,
    });
    return res.json({ job: toApiJob(updated) });
  });

  app.get("/api/myfans/affiliate/stats", async (_req, res) => {
    const counts = await store.countsByStatus();
    res.json({
      counts: {
        pending_manual: counts.pending_manual || 0,
        done_manual: counts.done_manual || 0,
        unsupported_url: counts.unsupported_url || 0,
        affiliate_disabled: counts.affiliate_disabled || 0,
      },
    });
  });

  app.post("/api/myfans/posts/drafts", async (req, res) => {
    const affiliateJobIdError = requireString(req.body?.affiliateJobId, "affiliateJobId");
    if (affiliateJobIdError) {
      return res.status(400).json({ error: affiliateJobIdError });
    }

    const text = (req.body?.text || "").trim();
    if (!text) {
      return res.status(400).json({ error: "text is required." });
    }

    let readyJob;
    try {
      readyJob = await store.assertAffiliateJobReadyForPostGeneration(req.body.affiliateJobId);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const validation = validateDraftText({
      text,
      affiliateUrl: readyJob.affiliateUrl,
    });
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    const platform = req.body?.platform || POST_DRAFT_PLATFORM.X;
    if (platform !== POST_DRAFT_PLATFORM.X) {
      return res.status(400).json({ error: "platform must be x." });
    }

    const hashtags = Array.isArray(req.body?.hashtags) ? req.body.hashtags : [];
    const created = await postDraftStore.createDraft({
      affiliateJobId: readyJob.id,
      platform,
      text,
      affiliateUrl: readyJob.affiliateUrl,
      hashtagsJson: JSON.stringify(hashtags),
      status: POST_DRAFT_STATUS.DRAFT,
      generatedBy: req.body?.generatedBy || null,
      generationPromptVersion: req.body?.generationPromptVersion || null,
      generationProviderResponseId: req.body?.generationProviderResponseId || null,
    });

    return res.status(201).json({ draft: toApiPostDraft(created, null, readyJob) });
  });

  app.get("/api/myfans/posts/drafts", async (req, res) => {
    const status = req.query?.status || undefined;
    const affiliateJobId = req.query?.affiliateJobId || undefined;
    const generatedBy = req.query?.generatedBy || undefined;
    const hasClip = parseHasClip(req.query?.hasClip);
    const limit = parseLimit(req.query?.limit);

    const drafts = await postDraftStore.list({
      status,
      affiliateJobId,
      generatedBy,
      hasClip,
      limit,
    });

    const withClip = await Promise.all(
      drafts.map(async (draft) => {
        const clip = draft.clipId ? await clipStore.getById(draft.clipId) : null;
        const affiliateJob = await store.getAffiliateJobById(draft.affiliateJobId);
        return toApiPostDraft(draft, clip, affiliateJob);
      }),
    );

    return res.json({ drafts: withClip });
  });

  app.patch("/api/myfans/posts/drafts/:id/status", async (req, res) => {
    const draft = await postDraftStore.getById(req.params.id);
    if (!draft) {
      return res.status(404).json({ error: "Draft not found." });
    }

    const nextStatus = req.body?.status;
    const allowedStatuses = new Set([
      POST_DRAFT_STATUS.APPROVED,
      POST_DRAFT_STATUS.REJECTED,
      POST_DRAFT_STATUS.DRAFT,
    ]);
    if (!allowedStatuses.has(nextStatus)) {
      return res.status(400).json({ error: "status must be approved, rejected, or draft." });
    }

    const updated = await postDraftStore.updateStatus({
      id: req.params.id,
      status: nextStatus,
    });
    const clip = updated.clipId ? await clipStore.getById(updated.clipId) : null;
    const affiliateJob = await store.getAffiliateJobById(updated.affiliateJobId);
    return res.json({ draft: toApiPostDraft(updated, clip, affiliateJob) });
  });

  app.post("/api/myfans/posts/drafts/:id/attach-clip", async (req, res) => {
    const clipIdError = requireString(req.body?.clipId, "clipId");
    if (clipIdError) {
      return res.status(400).json({ error: clipIdError });
    }

    const draft = await postDraftStore.getById(req.params.id);
    if (!draft) {
      return res.status(404).json({ error: "Draft not found." });
    }
    if (draft.status === POST_DRAFT_STATUS.POSTED) {
      return res.status(400).json({ error: "posted draft is immutable." });
    }

    const clip = await clipStore.getById(req.body.clipId);
    if (!clip) {
      return res.status(404).json({ error: "Clip not found." });
    }
    const clipValidation = isClipUsableForDraft(clip);
    if (!clipValidation.ok) {
      return res.status(400).json({ error: clipValidation.reason });
    }

    const updated = await postDraftStore.attachClip({
      id: req.params.id,
      clipId: clip.id,
    });
    const affiliateJob = await store.getAffiliateJobById(updated.affiliateJobId);
    return res.json({ draft: toApiPostDraft(updated, clip, affiliateJob) });
  });

  app.post("/api/myfans/posts/drafts/:id/mark-manually-posted", async (req, res) => {
    const draft = await postDraftStore.getById(req.params.id);
    if (!draft) {
      return res.status(404).json({ error: "Draft not found." });
    }
    if (draft.status !== POST_DRAFT_STATUS.APPROVED) {
      return res.status(400).json({ error: "Only approved draft can be marked as posted." });
    }

    const textValidation = validateDraftText({
      text: draft.text,
      affiliateUrl: draft.affiliateUrl,
    });
    if (!textValidation.ok) {
      return res.status(400).json({ error: textValidation.error });
    }

    const clip = draft.clipId ? await clipStore.getById(draft.clipId) : null;
    const readiness = isDraftPostReady(draft, clip);
    if (!readiness.ok) {
      return res.status(400).json({ error: `Draft is not post-ready: ${readiness.reason}` });
    }

    const postedAtRaw = req.body?.postedAt;
    let postedAt = new Date().toISOString();
    if (postedAtRaw != null) {
      const parsed = new Date(String(postedAtRaw));
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: "postedAt must be a valid ISO datetime." });
      }
      postedAt = parsed.toISOString();
    }
    const note = typeof req.body?.note === "string" ? req.body.note.trim() || null : null;

    const updated = await postDraftStore.markManuallyPosted({
      id: req.params.id,
      postedAt,
      note,
    });
    const updatedClip = updated.clipId ? await clipStore.getById(updated.clipId) : null;
    const affiliateJob = await store.getAffiliateJobById(updated.affiliateJobId);
    return res.json({ draft: toApiPostDraft(updated, updatedClip, affiliateJob) });
  });

  async function handleGenerateDrafts(req, res) {
    const affiliateJobIdError = requireString(req.body?.affiliateJobId, "affiliateJobId");
    if (affiliateJobIdError) {
      return res.status(400).json({ error: affiliateJobIdError });
    }

    let variantCount;
    try {
      variantCount = parseVariantCount(req.body?.variantCount);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    const tone = (req.body?.tone || "natural").trim() || "natural";

    let readyJob;
    try {
      readyJob = await store.assertAffiliateJobReadyForPostGeneration(req.body.affiliateJobId);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    let clip = null;
    if (req.body?.clipId) {
      clip = await clipStore.getById(req.body.clipId);
      if (!clip) {
        return res.status(404).json({ error: "Clip not found." });
      }
      const clipValidation = isClipUsableForDraft(clip);
      if (!clipValidation.ok) {
        return res.status(400).json({ error: clipValidation.reason });
      }
    }

    const maxLength = postGenerationOps.maxLength();
    const ngWords = postGenerationOps.ngWords();
    const contentHints = postGenerationOps.contentHints(req.body || {});

    let generation;
    try {
      generation = await postGenerationOps.generateDrafts({
        affiliateUrl: readyJob.affiliateUrl,
        sourceUrl: readyJob.sourceUrl,
        tone,
        variantCount,
        maxLength,
        ngWords,
        contentHints,
      });
    } catch (error) {
      const fallbackEnabled = postGenerationOps.isTemplateFallbackEnabled();
      if (!fallbackEnabled) {
        const status = Number.isInteger(error.statusCode) ? error.statusCode : 502;
        return res.status(status).json({ error: error.message });
      }
      generation = postGenerationOps.templateFallbackDrafts({
        affiliateUrl: readyJob.affiliateUrl,
        tone,
        variantCount,
      });
    }

    const rawDrafts = Array.isArray(generation.drafts)
      ? generation.drafts
      : Array.isArray(generation.variants)
        ? generation.variants.map((text) => ({ text }))
        : [];
    if (rawDrafts.length === 0) {
      return res.status(502).json({ error: "No draft text variants were generated." });
    }

    const seen = new Set();
    const drafts = [];
    for (const candidate of rawDrafts) {
      const text = String(candidate?.text || "").trim();
      if (!text || seen.has(text)) {
        continue;
      }

      const validation = postGenerationOps.isDraftTextValid({
        text,
        affiliateUrl: readyJob.affiliateUrl,
        maxLength,
        ngWords,
      });
      if (!validation.ok) {
        continue;
      }
      seen.add(text);

      const created = await postDraftStore.createDraft({
        affiliateJobId: readyJob.id,
        clipId: clip?.id || null,
        platform: POST_DRAFT_PLATFORM.X,
        text,
        affiliateUrl: readyJob.affiliateUrl,
        hashtagsJson: "[]",
        status: POST_DRAFT_STATUS.DRAFT,
        generatedBy: postGenerationOps.providerName(),
        generationPromptVersion: postGenerationOps.promptVersion(),
        generationProviderResponseId: generation.responseId || null,
      });
      drafts.push(toApiPostDraft(created, clip, readyJob));
      if (drafts.length >= variantCount) {
        break;
      }
    }

    if (drafts.length === 0) {
      return res.status(502).json({ error: "All generated drafts failed validation." });
    }

    return res.status(201).json({ drafts });
  }

  app.post("/api/myfans/posts/generate-drafts", handleGenerateDrafts);
  app.post("/api/myfans/posts/create-with-clip", handleGenerateDrafts);

  app.get("/api/videos/clips", async (_req, res) => {
    const clips = await clipStore.listAll();
    return res.json({ clips: clips.map(toApiClip) });
  });

  app.get("/api/videos/assets", async (_req, res) => {
    const assets = await videoStore.listAll();
    res.json({ assets: assets.map(toApiVideoAsset) });
  });

  app.get("/api/videos/assets/:id", async (req, res) => {
    const asset = await videoStore.getById(req.params.id);
    if (!asset) {
      return res.status(404).json({ error: "Video asset not found." });
    }
    return res.json({ asset: toApiVideoAsset(asset) });
  });

  app.post("/api/videos/assets/register-local", async (req, res) => {
    const filePathError = requireString(req.body?.filePath, "filePath");
    if (filePathError) {
      return res.status(400).json({ error: filePathError });
    }
    const rightsConfirmed = parseRightsConfirmed(req.body?.rightsConfirmed);
    if (rightsConfirmed !== true) {
      return res
        .status(400)
        .json({ error: "rightsConfirmed must be true. Rights-cleared material only." });
    }

    try {
      const asset = await videoOps.registerLocalVideoAsset({
        store: videoStore,
        filePath: req.body.filePath,
        rightsConfirmed: true,
      });
      return res.status(201).json({ asset: toApiVideoAsset(asset) });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.post("/api/videos/assets/:id/clean-ui", async (req, res) => {
    let uiCropTop;
    let uiCropBottom;
    let uiCropLeft;
    let uiCropRight;
    try {
      uiCropTop = parseCropInt(req.body?.uiCropTop ?? 0, "uiCropTop");
      uiCropBottom = parseCropInt(req.body?.uiCropBottom ?? 0, "uiCropBottom");
      uiCropLeft = parseCropInt(req.body?.uiCropLeft ?? 0, "uiCropLeft");
      uiCropRight = parseCropInt(req.body?.uiCropRight ?? 0, "uiCropRight");
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const uiMasks = Array.isArray(req.body?.uiMasks) ? req.body.uiMasks : [];
    try {
      const asset = await videoOps.cleanVideoUi({
        store: videoStore,
        id: req.params.id,
        uiCropTop,
        uiCropBottom,
        uiCropLeft,
        uiCropRight,
        uiMasks,
      });
      return res.json({ asset: toApiVideoAsset(asset) });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  return app;
}

module.exports = {
  DEFAULT_GENERATOR_URL,
  createApp,
};
