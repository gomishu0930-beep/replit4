import type { ComplianceDecision, RiskFlag } from './agent-types.js';
import { filterContent } from './content-filter.js';

const DISCLOSURE_PATTERN = /(PR|広告|アフィリエイト|affiliate)/i;
const URL_PATTERN = /https?:\/\/\S+/i;

function similarity(a: string, b: string): number {
  const left = new Set(a.replace(/\s+/g, '').slice(0, 180));
  const right = new Set(b.replace(/\s+/g, '').slice(0, 180));
  if (left.size === 0 || right.size === 0) return 0;
  let hit = 0;
  for (const ch of left) if (right.has(ch)) hit++;
  return hit / Math.max(left.size, right.size);
}

export function runComplianceGuard(
  text: string,
  opts: {
    isAffiliate?: boolean;
    recentTexts?: string[];
    officialMaterialOnly?: boolean;
    mediaRightsConfirmed?: boolean;
  } = {},
): ComplianceDecision {
  const isAffiliate = opts.isAffiliate ?? true;
  const flags: RiskFlag[] = [];
  let normalizedText = text.trim();

  if (isAffiliate && !DISCLOSURE_PATTERN.test(normalizedText)) {
    normalizedText = `PR・広告｜${normalizedText}`;
    flags.push({
      code: 'disclosure_added',
      severity: 'warning',
      message: 'PR/広告/アフィリエイト表記がなかったため自動補完しました',
    });
  }

  if (isAffiliate && !URL_PATTERN.test(normalizedText)) {
    flags.push({
      code: 'affiliate_link_expected_in_reply',
      severity: 'info',
      message: '本文内URLはありません。アフィリエイトリンクは承認後のリプライ導線で明示してください',
    });
  }

  const filter = filterContent(normalizedText, 'strict');
  if (!filter.safe) {
    flags.push({
      code: 'blocked_content_filter',
      severity: 'critical',
      message: filter.reason ?? `禁止ワード: ${filter.blockedWords.join(', ')}`,
    });
  }

  if (opts.officialMaterialOnly === false || opts.mediaRightsConfirmed === false) {
    flags.push({
      code: 'media_rights_unconfirmed',
      severity: 'critical',
      message: '公式に利用可能な素材、または権利確認済み素材であることを確認できません',
    });
  }

  const normalizedLower = normalizedText.toLowerCase();
  if (/無断転載|転載|拾い画|拾った画像|保存した動画/.test(normalizedText)) {
    flags.push({
      code: 'unauthorized_repost_risk',
      severity: 'critical',
      message: '無断転載や権利不明素材を示す表現があります',
    });
  }
  if (/アルゴリズム.*(回避|攻略|操作)|シャドウバン.*回避|大量投稿|スパム/.test(normalizedText)) {
    flags.push({
      code: 'platform_manipulation_risk',
      severity: 'critical',
      message: 'Xポリシー違反やプラットフォーム操作を連想させる表現があります',
    });
  }
  if (normalizedLower.includes('teen') || /未成年|高校生|中学生|小学生|jk|jc|js|ロリ/i.test(normalizedText)) {
    flags.push({
      code: 'minor_risk',
      severity: 'critical',
      message: '未成年関連または未成年を連想させる表現があります',
    });
  }
  if (/非同意|強制|無理やり|レイプ|盗撮|催眠|睡眠薬/.test(normalizedText)) {
    flags.push({
      code: 'nonconsent_risk',
      severity: 'critical',
      message: '非同意・強制・薬物等を連想させる表現があります',
    });
  }

  for (const recent of opts.recentTexts ?? []) {
    if (similarity(normalizedText, recent) >= 0.82) {
      flags.push({
        code: 'near_duplicate_post',
        severity: 'warning',
        message: '直近投稿と類似度が高く、連投・重複投稿に見える可能性があります',
      });
      break;
    }
  }

  return {
    allowed: !flags.some((flag) => flag.severity === 'critical'),
    normalizedText,
    risk_flags: flags,
    sensitive_media: true,
  };
}

export function validateProposalSchema(value: any): boolean {
  return Boolean(
    value &&
    typeof value.id === 'string' &&
    typeof value.recommended_work_type === 'string' &&
    typeof value.recommended_genre === 'string' &&
    typeof value.draft_text === 'string' &&
    typeof value.cta === 'string' &&
    Array.isArray(value.hashtags) &&
    ['none', 'image', 'video'].includes(value.media_format) &&
    typeof value.recommended_post_time_jst === 'string' &&
    Array.isArray(value.avoid_patterns) &&
    typeof value.reason === 'string' &&
    typeof value.confidence === 'number' &&
    typeof value.expected_effect === 'string' &&
    value.attached_media &&
    ['none', 'image', 'video'].includes(value.attached_media.format) &&
    ['official_fanza', 'rights_confirmed', 'none'].includes(value.attached_media.source) &&
    Array.isArray(value.risk_flags),
  );
}
