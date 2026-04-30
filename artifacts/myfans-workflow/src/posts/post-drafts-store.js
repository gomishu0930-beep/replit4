const { randomUUID } = require("node:crypto");
const {
  POST_DRAFT_PLATFORM,
  POST_DRAFT_STATUS,
  POST_DRAFT_GENERATED_BY,
} = require("./post-draft-status");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createPostDraftsStore(initialDrafts = [], nowProvider = () => new Date().toISOString()) {
  const drafts = [...initialDrafts];

  function getByIdRef(id) {
    return drafts.find((draft) => draft.id === id) || null;
  }

  function listAll() {
    return drafts.map(clone);
  }

  function getById(id) {
    const ref = getByIdRef(id);
    return ref ? clone(ref) : null;
  }

  function createDraft({
    affiliateJobId,
    clipId = null,
    platform = POST_DRAFT_PLATFORM.X,
    text,
    affiliateUrl,
    hashtagsJson = "[]",
    status = POST_DRAFT_STATUS.DRAFT,
    generatedBy = null,
    generationPromptVersion = null,
    generationProviderResponseId = null,
    xPostId = null,
    xMediaId = null,
    scheduledAt = null,
    postedAt = null,
    manualPostNote = null,
  }) {
    const now = nowProvider();
    const created = {
      id: randomUUID(),
      affiliateJobId,
      clipId,
      platform,
      text,
      affiliateUrl,
      hashtagsJson,
      status,
      generatedBy,
      generationPromptVersion,
      generationProviderResponseId,
      xPostId,
      xMediaId,
      scheduledAt,
      postedAt,
      manualPostNote,
      createdAt: now,
      updatedAt: now,
    };
    drafts.push(created);
    return clone(created);
  }

  function updateStatus({ id, status }) {
    const ref = getByIdRef(id);
    if (!ref) {
      return null;
    }
    ref.status = status;
    ref.updatedAt = nowProvider();
    return clone(ref);
  }

  function markManuallyPosted({ id, postedAt, note = null }) {
    const ref = getByIdRef(id);
    if (!ref) {
      return null;
    }
    ref.status = POST_DRAFT_STATUS.POSTED;
    ref.postedAt = postedAt;
    ref.manualPostNote = note;
    ref.updatedAt = nowProvider();
    return clone(ref);
  }

  function attachClip({ id, clipId }) {
    const ref = getByIdRef(id);
    if (!ref) {
      return null;
    }
    ref.clipId = clipId;
    ref.updatedAt = nowProvider();
    return clone(ref);
  }

  function list({ status, affiliateJobId, generatedBy, hasClip, limit }) {
    let rows = listAll();
    if (status) {
      rows = rows.filter((draft) => draft.status === status);
    }
    if (affiliateJobId) {
      rows = rows.filter((draft) => draft.affiliateJobId === affiliateJobId);
    }
    if (generatedBy) {
      rows = rows.filter((draft) => draft.generatedBy === generatedBy);
    }
    if (typeof hasClip === "boolean") {
      rows = rows.filter((draft) => (hasClip ? Boolean(draft.clipId) : !draft.clipId));
    }
    if (Number.isInteger(limit) && limit > 0) {
      rows = rows.slice(0, limit);
    }
    return rows;
  }

  return {
    attachClip,
    createDraft,
    getById,
    list,
    listAll,
    markManuallyPosted,
    updateStatus,
  };
}

module.exports = {
  createPostDraftsStore,
  POST_DRAFT_GENERATED_BY,
  POST_DRAFT_PLATFORM,
  POST_DRAFT_STATUS,
};
