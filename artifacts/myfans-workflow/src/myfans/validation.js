function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validateSourceUrl(sourceUrl) {
  const value = (sourceUrl || "").trim();
  if (!value) {
    return { ok: false, message: "sourceUrl is required." };
  }
  if (!isValidHttpUrl(value)) {
    return { ok: false, message: "sourceUrl must be a valid URL." };
  }

  const parsed = new URL(value);
  const host = parsed.hostname.toLowerCase();
  const allowed = host === "myfans.jp" || host === "www.myfans.jp";
  if (!allowed) {
    return { ok: false, message: "sourceUrl must be https://myfans.jp/* or https://www.myfans.jp/*." };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, message: "sourceUrl must use https." };
  }
  return { ok: true, value };
}

function hasAffiliateHint(affiliateUrl) {
  const normalized = affiliateUrl.toLowerCase();
  return ["myfans", "affiliate", "aff", "referral", "ref"].some((piece) =>
    normalized.includes(piece),
  );
}

function validateAffiliateUrl(affiliateUrl) {
  const value = (affiliateUrl || "").trim();
  if (!value) {
    return { ok: false, message: "affiliateUrl is required." };
  }
  if (!isValidHttpUrl(value)) {
    return { ok: false, message: "affiliateUrl must be a valid URL." };
  }
  return {
    ok: true,
    value,
    hasAffiliateHint: hasAffiliateHint(value),
  };
}

module.exports = {
  hasAffiliateHint,
  isValidHttpUrl,
  validateAffiliateUrl,
  validateSourceUrl,
};
