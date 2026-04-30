const JOB_STATUS = Object.freeze({
  QUEUED: "queued",
  PENDING_MANUAL: "pending_manual",
  DONE: "done",
  DONE_MANUAL: "done_manual",
  ERROR: "error",
  UNSUPPORTED_URL: "unsupported_url",
  AFFILIATE_DISABLED: "affiliate_disabled",
  LOGIN_REQUIRED: "login_required",
  VERIFICATION_REQUIRED: "verification_required",
});

const MOBILE_SKIP_REASONS = new Set([
  JOB_STATUS.UNSUPPORTED_URL,
  JOB_STATUS.AFFILIATE_DISABLED,
  JOB_STATUS.ERROR,
]);

const MANUAL_TERMINAL_STATUSES = new Set([
  JOB_STATUS.DONE_MANUAL,
  JOB_STATUS.UNSUPPORTED_URL,
  JOB_STATUS.AFFILIATE_DISABLED,
  JOB_STATUS.ERROR,
]);

module.exports = {
  JOB_STATUS,
  MANUAL_TERMINAL_STATUSES,
  MOBILE_SKIP_REASONS,
};
