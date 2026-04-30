const POST_DRAFT_PLATFORM = Object.freeze({
  X: "x",
});

const POST_DRAFT_STATUS = Object.freeze({
  DRAFT: "draft",
  APPROVED: "approved",
  SCHEDULED: "scheduled",
  POSTED: "posted",
  REJECTED: "rejected",
});

const POST_DRAFT_GENERATED_BY = Object.freeze({
  CLAUDE_REPLIT: "claude_replit",
  TEMPLATE: "template",
  MANUAL: "manual",
});

module.exports = {
  POST_DRAFT_GENERATED_BY,
  POST_DRAFT_PLATFORM,
  POST_DRAFT_STATUS,
};
