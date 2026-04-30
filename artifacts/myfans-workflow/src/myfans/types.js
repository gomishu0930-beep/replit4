const ERROR_CODES = Object.freeze({
  LOGIN_REQUIRED: "login_required",
  TARGET_NOT_SUPPORTED: "target_not_supported",
  AFFILIATE_OPT_OUT: "affiliate_opt_out",
  SELECTOR_CHANGED: "selector_changed",
  VERIFICATION_REQUIRED: "verification_required",
});

const TERMINAL_ERROR_CODES = new Set([
  ERROR_CODES.LOGIN_REQUIRED,
  ERROR_CODES.VERIFICATION_REQUIRED,
]);

module.exports = {
  ERROR_CODES,
  TERMINAL_ERROR_CODES,
};
