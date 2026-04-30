const { CLIP_STATUS } = require("../clips/clips-store");
const { POST_DRAFT_STATUS } = require("./post-drafts-store");
const { validateDraftText } = require("./post-draft-validation");

function hasOutputPath(clip) {
  return Boolean((clip?.outputPath || clip?.filePath || "").trim());
}

function isCleanDerivedClip(clip) {
  const sourceType = (clip?.sourceType || "").toLowerCase();
  if (sourceType) {
    return sourceType === "clean";
  }

  const outputPath = (clip?.outputPath || clip?.filePath || "").replaceAll("\\", "/");
  return outputPath.startsWith(".generated/clips/");
}

function isClipUsableForDraft(clip) {
  if (!clip) {
    return { ok: false, reason: "clip not found." };
  }
  if (!(clip.status === CLIP_STATUS.APPROVED || clip.status === CLIP_STATUS.GENERATED)) {
    return { ok: false, reason: "clip status must be approved or generated." };
  }
  if (!hasOutputPath(clip)) {
    return { ok: false, reason: "clip outputPath is required." };
  }
  if (!isCleanDerivedClip(clip)) {
    return { ok: false, reason: "clip must be derived from cleaned video." };
  }
  return { ok: true };
}

function isDraftPostReady(draft, clip) {
  if (!draft) {
    return { ok: false, reason: "draft not found." };
  }
  if (draft.status !== POST_DRAFT_STATUS.APPROVED) {
    return { ok: false, reason: "draft status must be approved." };
  }

  const textValidation = validateDraftText({
    text: draft.text,
    affiliateUrl: draft.affiliateUrl,
  });
  if (!textValidation.ok) {
    return { ok: false, reason: textValidation.error };
  }

  if (!draft.clipId) {
    return { ok: false, reason: "draft.clipId is required." };
  }

  const clipValidation = isClipUsableForDraft(clip);
  if (!clipValidation.ok) {
    return { ok: false, reason: clipValidation.reason };
  }

  return { ok: true };
}

module.exports = {
  isClipUsableForDraft,
  isDraftPostReady,
};
