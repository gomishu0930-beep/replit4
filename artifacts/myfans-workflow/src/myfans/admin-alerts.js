const { ERROR_CODES } = require("./types");

function getAdminAlertForResult(result) {
  if (!result || result.status !== "error") {
    return null;
  }

  if (result.errorCode === ERROR_CODES.VERIFICATION_REQUIRED) {
    return {
      severity: "critical",
      title: "verification_required",
      message:
        "MyFans側のbot検証が表示されています。通常ブラウザで手動生成してください。自動突破は行いません。",
    };
  }

  return null;
}

module.exports = {
  getAdminAlertForResult,
};
