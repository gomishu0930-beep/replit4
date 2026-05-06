import { randomUUID } from 'crypto';
import type {
  AgentRunInput,
  ClassifiedMarketPost,
  DraftProposal,
  FanzaWorkCandidate,
  LearningSignal,
  MarketComparisonSummary,
  MarketPatternType,
  MediaRecommendation,
  MediaType,
  OwnAccountGap,
  OwnPostComparison,
  PatternSummary,
  RankedMarketPost,
  RecommendationSchemaOutput,
  RiskFlag,
  ScheduleRecommendation,
} from './agent-types.js';
import { getProposalFeedback, type AgentProposalFeedback } from './agent-learning-store.js';
import { runComplianceGuard } from './compliance-guard.js';
import { getRevenueOptimizedItems, getSampleImages, scoreFanzaItem } from './fanza.js';

const PATTERN_LABELS: Record<MarketPatternType, string> = {
  work_title_appeal: '作品名訴求',
  actress_name_appeal: '女優名訴求',
  genre_appeal: 'ジャンル訴求',
  sale_appeal: 'セール訴求',
  ranking_appeal: 'ランキング訴求',
  image_main: '画像メイン',
  video_main: '動画メイン',
  short_cta: '短文CTA',
  long_review: '長文レビュー',
  thread_type: 'スレッド型',
  profile_redirect: 'プロフィール誘導型',
};

const GENRE_KEYWORDS = ['人妻', 'OL', '素人', '巨乳', '熟女', 'ギャル', '美少女', '企画', '単体', '同人', 'VR', 'セール'];

function average(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function jstHour(iso: string): number {
  const d = new Date(iso);
  return (d.getUTCHours() + 9) % 24;
}

function inferGenre(text: string, fallback = 'general'): string {
  return GENRE_KEYWORDS.find((genre) => text.includes(genre)) ?? fallback;
}

function hasTitleLikePhrase(text: string): boolean {
  return /[【「『].{4,40}[】」』]/.test(text) || /作品|タイトル|新作|名作|一本|これ/.test(text);
}

function hasActressLikePhrase(text: string): boolean {
  return /女優|出演|ちゃん|さん|推し|単体/.test(text) && /[一-龥ぁ-んァ-ン]{2,8}/.test(text);
}

function classifyPatterns(text: string, mediaType: MediaType, hasUrl: boolean): { patterns: MarketPatternType[]; reasons: string[] } {
  const patterns = new Set<MarketPatternType>();
  const reasons: string[] = [];
  if (hasTitleLikePhrase(text)) {
    patterns.add('work_title_appeal');
    reasons.push('作品名/作品文脈を前面に出している');
  }
  if (hasActressLikePhrase(text)) {
    patterns.add('actress_name_appeal');
    reasons.push('女優名または出演者文脈がある');
  }
  if (GENRE_KEYWORDS.some((genre) => text.includes(genre))) {
    patterns.add('genre_appeal');
    reasons.push('ジャンル名で探索需要に寄せている');
  }
  if (/セール|割引|OFF|お得|限定|キャンペーン|還元/.test(text)) {
    patterns.add('sale_appeal');
    reasons.push('価格/セール理由がある');
  }
  if (/ランキング|人気|上位|1位|TOP|ベスト|レビュー.*件/.test(text)) {
    patterns.add('ranking_appeal');
    reasons.push('ランキング/社会的証明を使っている');
  }
  if (mediaType === 'photo' || mediaType === 'mixed') {
    patterns.add('image_main');
    reasons.push('画像が主役になりやすい');
  }
  if (mediaType === 'video' || mediaType === 'animated_gif') {
    patterns.add('video_main');
    reasons.push('動画/動きのある素材を使っている');
  }
  if (text.length <= 90 && (/詳細|リプ|プロフ|見て|チェック|こちら|👇/.test(text) || hasUrl)) {
    patterns.add('short_cta');
    reasons.push('短い導線でクリックを促している');
  }
  if (text.length >= 180 || /レビュー|感想|刺さる|良かった|評価/.test(text)) {
    patterns.add('long_review');
    reasons.push('レビュー/文脈説明で納得感を作っている');
  }
  if (/スレ|ツリー|続き|1\/|①|②|リプで/.test(text)) {
    patterns.add('thread_type');
    reasons.push('スレッド/リプ展開を前提にしている');
  }
  if (/プロフィール|プロフ|固定|bio|リンク集/.test(text)) {
    patterns.add('profile_redirect');
    reasons.push('プロフィール導線を使っている');
  }
  if (patterns.size === 0) {
    patterns.add(hasUrl ? 'short_cta' : 'genre_appeal');
    reasons.push('明確な型が弱いため、URL有無と本文から近い型に分類');
  }
  return { patterns: [...patterns], reasons };
}

export function classifyOwnPostPattern(text: string, mediaType: MediaType, hasUrl: boolean): MarketPatternType[] {
  return classifyPatterns(text, mediaType, hasUrl).patterns;
}

export function classifyMarketPosts(posts: RankedMarketPost[]): ClassifiedMarketPost[] {
  return posts.map((post) => {
    const { patterns, reasons } = classifyPatterns(post.text, post.media_type, post.has_url);
    return {
      ...post,
      pattern_types: patterns,
      appeal_axis: patterns[0] ?? 'genre_appeal',
      inferred_genre: inferGenre(`${post.text} ${post.hashtags.join(' ')}`),
      classification_reason: reasons,
    };
  });
}

export function summarizeWinningPatterns(posts: ClassifiedMarketPost[]): PatternSummary[] {
  const grouped = new Map<MarketPatternType, ClassifiedMarketPost[]>();
  for (const post of posts) {
    for (const pattern of post.pattern_types) {
      const bucket = grouped.get(pattern) ?? [];
      bucket.push(post);
      grouped.set(pattern, bucket);
    }
  }
  return [...grouped.entries()]
    .map(([pattern, bucket]) => ({
      pattern,
      label: PATTERN_LABELS[pattern],
      count: bucket.length,
      avgGrowthScore: Number(average(bucket.map((p) => p.growth_score)).toFixed(3)),
      avgEngagementRate: Number(average(bucket.map((p) => p.engagement_rate)).toFixed(5)),
      marketShare: posts.length ? Number((bucket.length / posts.length).toFixed(4)) : 0,
      reason: `${PATTERN_LABELS[pattern]}が${bucket.length}件、平均growth_score=${average(bucket.map((p) => p.growth_score)).toFixed(1)}`,
    }))
    .sort((a, b) => b.avgGrowthScore - a.avgGrowthScore || b.count - a.count)
    .slice(0, 10);
}

export function extractOwnAccountGaps(
  winningPatterns: PatternSummary[],
  ownPosts: OwnPostComparison[],
  marketPosts: ClassifiedMarketPost[],
  comparison: Pick<MarketComparisonSummary, 'bestMarketHours' | 'bestOwnHours' | 'mediaLift'>,
): OwnAccountGap[] {
  const gaps: OwnAccountGap[] = [];
  const ownPatterns = new Set(ownPosts.flatMap((post) => post.patternTypes));
  const ownAvgImpressions = average(ownPosts.map((post) => post.impressions).filter((n) => n > 0));
  const ownGenres = new Set(ownPosts.map((post) => post.genre).filter(Boolean));

  for (const pattern of winningPatterns.slice(0, 6)) {
    if (!ownPatterns.has(pattern.pattern)) {
      gaps.push({
        code: 'unused_winning_pattern',
        severity: 'warning',
        axis: 'pattern',
        message: `競合では${pattern.label}が伸びていますが、自分の直近投稿ではほぼ使えていません`,
        recommended_action: `${pattern.label}を1作品2案のうち最低1案に採用する`,
        evidence: [pattern.reason],
      });
    }
  }

  const goodEngagementNoRevenue = ownPosts
    .filter((post) => post.engagementRate >= Math.max(0.01, average(ownPosts.map((p) => p.engagementRate))) && post.conversions === 0 && post.revenue === 0)
    .slice(0, 3);
  if (goodEngagementNoRevenue.length > 0) {
    gaps.push({
      code: 'engagement_not_revenue',
      severity: 'warning',
      axis: 'revenue',
      message: '自分では反応が良いが成果に結びついていない型があります',
      recommended_action: '本文の共感/反応狙いを維持しつつ、CTAと作品選定をクリック後の期待値に合わせる',
      evidence: goodEngagementNoRevenue.map((post) => `${post.postId}: ER ${(post.engagementRate * 100).toFixed(2)}%, revenue ${post.revenue}`),
    });
  }

  const clickedNoConversion = ownPosts.filter((post) => post.urlClicks > 0 && post.conversions === 0).slice(0, 3);
  if (clickedNoConversion.length > 0) {
    gaps.push({
      code: 'clicks_without_cvr',
      severity: 'warning',
      axis: 'click',
      message: 'クリックはあるがCVRが悪い型があります',
      recommended_action: 'セール/レビュー/サンプル有無を明記し、クリック前の期待値と遷移先を一致させる',
      evidence: clickedNoConversion.map((post) => `${post.postId}: clicks ${post.urlClicks}, conversions ${post.conversions}`),
    });
  }

  const conversionLowExposure = ownPosts.filter((post) => post.conversions > 0 && post.impressions > 0 && post.impressions < ownAvgImpressions).slice(0, 3);
  if (conversionLowExposure.length > 0) {
    gaps.push({
      code: 'cvr_good_exposure_weak',
      severity: 'info',
      axis: 'exposure',
      message: 'CVRは高いが露出が弱い型があります',
      recommended_action: '同じ作品/訴求を、競合の強い時間帯と媒体形式で再テストする',
      evidence: conversionLowExposure.map((post) => `${post.postId}: conversions ${post.conversions}, impressions ${post.impressions}`),
    });
  }

  const marketHour = comparison.bestMarketHours[0]?.hour;
  const ownHour = comparison.bestOwnHours[0]?.hour;
  if (marketHour !== undefined && ownHour !== undefined && Math.abs(marketHour - ownHour) >= 3) {
    gaps.push({
      code: 'posting_hour_mismatch',
      severity: 'info',
      axis: 'time',
      message: '競合の強い投稿時間と自分の好調時間にズレがあります',
      recommended_action: `${String(marketHour).padStart(2, '0')}:00 JST をテスト枠に追加する`,
      evidence: [`market best=${marketHour}:00`, `own best=${ownHour}:00`],
    });
  }

  const marketMedia = comparison.mediaLift[0]?.mediaType;
  const ownMedia = ownPosts.length
    ? [...ownPosts.reduce((m, post) => m.set(post.mediaType, (m.get(post.mediaType) ?? 0) + 1), new Map<MediaType, number>()).entries()]
      .sort((a, b) => b[1] - a[1])[0]?.[0]
    : undefined;
  if (marketMedia && ownMedia && marketMedia !== ownMedia) {
    gaps.push({
      code: 'media_format_mismatch',
      severity: 'info',
      axis: 'media',
      message: '競合で伸びているメディア形式と自分の多用形式が違います',
      recommended_action: `${marketMedia}型の候補を優先して作る`,
      evidence: [`market=${marketMedia}`, `own=${ownMedia}`],
    });
  }

  const marketGenres = [...marketPosts.reduce((m, post) => m.set(post.inferred_genre, (m.get(post.inferred_genre) ?? 0) + 1), new Map<string, number>()).entries()]
    .filter(([genre]) => genre !== 'general')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  for (const [genre, count] of marketGenres) {
    if (!ownGenres.has(genre)) {
      gaps.push({
        code: 'genre_mismatch',
        severity: 'info',
        axis: 'genre',
        message: `市場では${genre}が目立つ一方、自分の投稿実績では薄いです`,
        recommended_action: `${genre}作品を候補に入れて、既存の強いCTAと組み合わせる`,
        evidence: [`market genre ${genre}: ${count} posts`],
      });
    }
  }

  return gaps.slice(0, 12);
}

function collectNames(values: any): string[] {
  return Array.isArray(values)
    ? values.map((v: any) => typeof v === 'string' ? v : v?.name ?? '').filter(Boolean)
    : [];
}

function itemGenres(item: any): string[] {
  return collectNames(item.iteminfo?.genre ?? item.genre);
}

function itemActresses(item: any): string[] {
  return collectNames(item.iteminfo?.actress ?? item.actress);
}

function sampleVideoUrl(item: any): string | undefined {
  const movie = item.sampleMovieURL ?? item.sampleVideoURL ?? item.movieURL;
  const match = movie ? JSON.stringify(movie).match(/https?:\/\/[^"\\]+/) : null;
  return match?.[0];
}

function hasSampleVideo(item: any): boolean {
  return Boolean(sampleVideoUrl(item));
}

function isSaleItem(item: any): boolean {
  return /セール|sale|SALE|割引|限定|キャンペーン|%OFF|OFF|ポイント|還元/.test(JSON.stringify({
    title: item.title,
    prices: item.prices,
    campaign: item.campaign ?? item.campaigns,
  }));
}

function mapWorkCandidate(item: any, marketPosts: ClassifiedMarketPost[], fallbackPatterns: PatternSummary[]): FanzaWorkCandidate {
  const base = scoreFanzaItem(item);
  const genres = itemGenres(item);
  const actresses = itemActresses(item);
  const title = String(item.title ?? '');
  const matchedMarket = marketPosts.filter((post) => {
    const haystack = `${post.text} ${post.hashtags.join(' ')}`;
    return genres.some((genre) => genre.length >= 2 && haystack.includes(genre))
      || actresses.some((name) => name.length >= 2 && haystack.includes(name))
      || title.split(/[ 　【】「」『』（）()・,，。:：/]+/).some((word) => word.length >= 3 && haystack.includes(word));
  });
  const marketBoost = Math.min(1.5, average(matchedMarket.slice(0, 10).map((post) => post.growth_score)) / 180);
  const sampleImages = getSampleImages(item);
  const videoUrl = sampleVideoUrl(item);
  const sampleVideo = Boolean(videoUrl);
  const rightsConfirmed = sampleImages.length > 0 || sampleVideo;
  const patterns = matchedMarket.length
    ? [...new Set(matchedMarket.flatMap((post) => post.pattern_types))].slice(0, 4)
    : fallbackPatterns.slice(0, 3).map((pattern) => pattern.pattern);
  const score = Number((base.score + marketBoost + (rightsConfirmed ? 0.4 : -0.8)).toFixed(3));
  const reasons = [
    ...base.reasons,
    marketBoost > 0 ? `X市場反応補正+${marketBoost.toFixed(2)}` : 'X市場一致は弱め',
    rightsConfirmed ? '公式サンプル素材あり' : '投稿に使える公式素材が未確認',
  ];

  return {
    content_id: String(item.content_id ?? item.cid ?? ''),
    title,
    affiliate_url: item.affiliateURL ?? item.affiliateUrl,
    genres,
    actresses,
    release_date: item.date,
    price: item.prices?.price ?? item.price,
    is_sale: isSaleItem(item),
    review_average: Number.parseFloat(item.review?.average ?? '0') || 0,
    review_count: Number(item.review?.count ?? 0),
    has_sample_images: sampleImages.length > 0,
    has_sample_video: sampleVideo,
    sample_image_urls: sampleImages,
    sample_video_url: videoUrl,
    rights_confirmed: rightsConfirmed,
    score,
    score_detail: { ...base.detail, x_market: Number(marketBoost.toFixed(3)), rights: rightsConfirmed ? 0.4 : -0.8 },
    reasons: reasons.filter(Boolean).slice(0, 8),
    matched_market_patterns: patterns,
  };
}

export async function scoreFanzaWorkCandidates(
  input: AgentRunInput,
  marketPosts: ClassifiedMarketPost[],
  winningPatterns: PatternSummary[],
): Promise<{ works: FanzaWorkCandidate[]; risks: RiskFlag[] }> {
  const risks: RiskFlag[] = [];
  const topGenre = marketPosts.find((post) => post.inferred_genre !== 'general')?.inferred_genre ?? input.genres[0];
  try {
    const items = await getRevenueOptimizedItems(Math.max(input.proposalCount * 3, 9), topGenre);
    const dedup = new Map<string, FanzaWorkCandidate>();
    for (const item of items) {
      const candidate = mapWorkCandidate(item, marketPosts, winningPatterns);
      if (!candidate.content_id && !candidate.title) continue;
      dedup.set(candidate.content_id || candidate.title, candidate);
    }
    const works = [...dedup.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(input.proposalCount, 5));
    if (works.length === 0) {
      risks.push({ code: 'fanza_candidate_empty', severity: 'warning', message: 'FANZA作品候補を取得できませんでした' });
    }
    return { works, risks };
  } catch (e: any) {
    return {
      works: [],
      risks: [{ code: 'fanza_candidate_fetch_failed', severity: 'warning', message: e.message ?? String(e) }],
    };
  }
}

export function buildMediaRecommendations(winningPatterns: PatternSummary[], works: FanzaWorkCandidate[]): MediaRecommendation[] {
  const hasVideoPattern = winningPatterns.some((p) => p.pattern === 'video_main');
  const hasImagePattern = winningPatterns.some((p) => p.pattern === 'image_main');
  const canUseVideo = works.some((work) => work.has_sample_video && work.rights_confirmed);
  const canUseImage = works.some((work) => work.has_sample_images && work.rights_confirmed);
  const recommendations: MediaRecommendation[] = [];
  if (hasVideoPattern && canUseVideo) {
    recommendations.push({ format: 'video', reason: '競合で動画メインが伸びており、公式サンプル動画が確認できる候補があります', confidence: 0.78, risk_flags: [] });
  }
  if ((hasImagePattern || !canUseVideo) && canUseImage) {
    recommendations.push({ format: 'image', reason: '画像メインの勝ち型に合わせ、公式サンプル画像を使えます', confidence: 0.72, risk_flags: [] });
  }
  recommendations.push({
    format: 'none',
    reason: '権利確認できない素材を使うくらいなら、短文CTAとリプ欄リンクで検証します',
    confidence: canUseImage || canUseVideo ? 0.35 : 0.65,
    risk_flags: canUseImage || canUseVideo ? [] : [{ code: 'media_rights_not_available', severity: 'warning', message: '公式または権利確認済み素材が不足しています' }],
  });
  return recommendations.slice(0, 3);
}

export function buildScheduleRecommendations(comparison: MarketComparisonSummary): ScheduleRecommendation[] {
  return comparison.bestMarketHours.slice(0, 3).map((slot, idx) => ({
    time_jst: `${String(slot.hour).padStart(2, '0')}:00`,
    reason: `市場投稿の平均growth_scoreが高い時間帯です (${slot.count}件)`,
    confidence: Math.max(0.45, 0.8 - idx * 0.1),
  }));
}

function proposalText(work: FanzaWorkCandidate | undefined, pattern: MarketPatternType, genre: string): { text: string; cta: string; workType: string; expected: string } {
  const title = work?.title ? `「${work.title.slice(0, 28)}」` : `${genre}系`;
  if (pattern === 'sale_appeal') {
    return {
      text: `PR・広告｜${title}\nセール/価格/レビューを見て、今日チェックする理由がある候補だけ拾いました。\n詳細はリプ欄で確認してください`,
      cta: '詳細はリプ欄で確認してください',
      workType: 'sale/revenue',
      expected: '価格理由を明確にしてクリック前の期待値を揃え、クリック品質を上げる',
    };
  }
  if (pattern === 'ranking_appeal') {
    return {
      text: `PR・広告｜${title}\nランキング/レビューの強さで選ぶなら、この一本は候補に入れてよさそうです。\n気になる人はリプ欄へ`,
      cta: '気になる人はリプ欄へ',
      workType: 'ranking/review',
      expected: '社会的証明で迷いを減らし、保存/クリックを増やす',
    };
  }
  if (pattern === 'video_main') {
    return {
      text: `PR・広告｜${title}\n動画サンプルで雰囲気を確認できる作品を優先しました。\n詳細はリプ欄に置きます`,
      cta: '詳細はリプ欄に置きます',
      workType: 'sample-video',
      expected: '動画確認ニーズに合わせ、媒体ミスマッチを減らす',
    };
  }
  if (pattern === 'long_review') {
    return {
      text: `PR・広告｜${title}\nレビュー数、評価、ジャンル相性を見て選定。勢いだけでなく、クリック後に納得しやすい候補です。\n詳細はリプ欄へ`,
      cta: '詳細はリプ欄へ',
      workType: 'review/proof',
      expected: 'レビュー文脈で納得感を作り、CVR改善を狙う',
    };
  }
  return {
    text: `PR・広告｜${title}\n${genre}で探す人向けに、レビューと素材確認まで見て候補を絞りました。\n詳細はリプ欄で確認してください`,
    cta: '詳細はリプ欄で確認してください',
    workType: 'genre/high-intent',
    expected: '市場で強いジャンル訴求を使い、露出とクリックの両方を狙う',
  };
}

export function generateImprovedDraftProposals(
  input: AgentRunInput,
  marketPosts: ClassifiedMarketPost[],
  ownPosts: OwnPostComparison[],
  comparison: MarketComparisonSummary,
  works: FanzaWorkCandidate[],
  mediaRecommendations: MediaRecommendation[],
  scheduleRecommendations: ScheduleRecommendation[],
): DraftProposal[] {
  const recentTexts = ownPosts.slice(0, 30).map((post) => post.textPreview);
  const winning = comparison.winningPatterns.length
    ? comparison.winningPatterns
    : [{ pattern: 'genre_appeal' as const, label: PATTERN_LABELS.genre_appeal, count: 0, avgGrowthScore: 0, avgEngagementRate: 0, marketShare: 0, reason: 'fallback' }];
  const fallbackWork: FanzaWorkCandidate | undefined = works[0];
  const targetWorks = works.length ? works.slice(0, Math.max(1, Math.ceil(input.proposalCount / 2))) : [fallbackWork];
  const proposals: DraftProposal[] = [];

  for (const work of targetWorks) {
    for (const patternSummary of winning.slice(0, 3)) {
      if (proposals.length >= input.proposalCount) break;
      const genre = work?.genres[0] ?? marketPosts.find((post) => post.inferred_genre !== 'general')?.inferred_genre ?? input.genres[0] ?? 'レビュー';
      const copy = proposalText(work, patternSummary.pattern, genre);
      const preferredMedia = mediaRecommendations.find((m) =>
        (m.format === 'video' && work?.has_sample_video) || (m.format === 'image' && work?.has_sample_images) || m.format === 'none',
      ) ?? mediaRecommendations[0];
      const sampleUrl = preferredMedia?.format === 'image' && work
        ? work.sample_image_urls[0]
        : preferredMedia?.format === 'video' && work
          ? work.sample_video_url
          : undefined;
      const attachedMedia = {
        format: preferredMedia?.format ?? 'none',
        source: preferredMedia?.format === 'none' ? 'none' as const : 'official_fanza' as const,
        reason: preferredMedia?.reason ?? '媒体推奨なし',
        sample_url: sampleUrl,
      };
      const hashtags = ['PR', genre, patternSummary.pattern === 'sale_appeal' ? 'セール' : 'FANZA']
        .filter(Boolean)
        .slice(0, 3);
      const rightsConfirmed = attachedMedia.format === 'none' || Boolean(work?.rights_confirmed);
      const compliance = runComplianceGuard(copy.text, {
        isAffiliate: true,
        recentTexts,
        officialMaterialOnly: true,
        mediaRightsConfirmed: rightsConfirmed,
      });
      const riskFlags = [...compliance.risk_flags];
      if (work && !work.rights_confirmed) {
        riskFlags.push({ code: 'work_media_rights_unconfirmed', severity: 'critical', message: '作品素材の権利確認ができないためメディア添付不可' });
      }
      proposals.push({
        id: randomUUID(),
        work,
        recommended_work_type: copy.workType,
        recommended_genre: genre,
        draft_text: compliance.normalizedText,
        cta: copy.cta,
        hashtags,
        media_format: attachedMedia.format,
        attached_media: attachedMedia,
        recommended_post_time_jst: scheduleRecommendations[proposals.length % Math.max(scheduleRecommendations.length, 1)]?.time_jst ?? '20:00',
        avoid_patterns: [
          'PR表記なしのアフィリエイト投稿',
          '同一テンプレートの連投',
          '権利確認できない画像/動画の添付',
          ...comparison.ownAccountGaps.slice(0, 2).map((gap) => gap.message),
        ],
        reason: [
          `${patternSummary.label}が市場で強い`,
          work ? `作品スコア${work.score}: ${work.reasons.slice(0, 3).join(' / ')}` : '作品候補不足のためジャンル仮説で生成',
          comparison.ownAccountGaps[0]?.recommended_action,
        ].filter(Boolean).join('。'),
        confidence: Number(Math.min(0.92, 0.48 + (patternSummary.avgGrowthScore / 450) + ((work?.score ?? 0) / 25)).toFixed(2)),
        expected_effect: copy.expected,
        risk_flags: riskFlags,
        market_evidence: [
          patternSummary.reason,
          ...marketPosts.filter((post) => post.pattern_types.includes(patternSummary.pattern)).slice(0, 2).map((post) => `${post.username || post.source}: ${post.text.slice(0, 100)}`),
        ],
        compliance: {
          ...compliance,
          allowed: compliance.allowed && !riskFlags.some((risk) => risk.severity === 'critical'),
          risk_flags: riskFlags,
        },
      });
    }
  }

  return proposals;
}

export async function buildLearningSignals(ownPosts: OwnPostComparison[]): Promise<LearningSignal[]> {
  const feedback: AgentProposalFeedback[] = await getProposalFeedback(80).catch(() => [] as AgentProposalFeedback[]);
  const approvals = feedback.filter((row) => row.decision === 'queued' || row.decision === 'approved' || row.decision === 'posted');
  const rejections = feedback.filter((row) => row.decision === 'rejected');
  const signals: LearningSignal[] = [];
  if (approvals.length > 0 || rejections.length > 0) {
    signals.push({
      code: 'proposal_feedback_available',
      message: '承認/却下履歴を次回提案の学習信号として利用できます',
      evidence: [`approved_or_queued=${approvals.length}`, `rejected=${rejections.length}`],
      weight: Math.min(1, (approvals.length + rejections.length) / 20),
    });
  }
  const postedWithClicks = ownPosts.filter((post) => post.urlClicks > 0);
  if (postedWithClicks.length > 0) {
    signals.push({
      code: 'post_click_results_available',
      message: '投稿後クリック実績を作品選定とCTA改善に利用します',
      evidence: postedWithClicks.slice(0, 5).map((post) => `${post.postId}: clicks=${post.urlClicks}, ctr=${(post.ctr * 100).toFixed(2)}%`),
      weight: Math.min(1, postedWithClicks.length / 20),
    });
  }
  if (signals.length === 0) {
    signals.push({
      code: 'learning_data_sparse',
      message: '投稿後結果と承認/却下理由が不足しているため、学習ループの信頼度は低めです',
      evidence: ['record post metrics, clicks, conversions, proposal feedback'],
      weight: 0.2,
    });
  }
  return signals;
}

export function buildRecommendationSchema(
  works: FanzaWorkCandidate[],
  winningPatterns: PatternSummary[],
  ownAccountGaps: OwnAccountGap[],
  proposals: DraftProposal[],
  mediaRecommendations: MediaRecommendation[],
  scheduleRecommendations: ScheduleRecommendation[],
  riskFlags: RiskFlag[],
  learningSignals: LearningSignal[],
): RecommendationSchemaOutput {
  const confidenceParts = [
    works.length ? 0.2 : 0,
    winningPatterns.length ? 0.2 : 0,
    proposals.length ? average(proposals.map((proposal) => proposal.confidence)) * 0.4 : 0,
    learningSignals.some((signal) => signal.code !== 'learning_data_sparse') ? 0.2 : 0.08,
  ];
  return {
    summary: `市場の勝ち型${winningPatterns.length}件、作品候補${works.length}件、draft${proposals.length}件を統合して提案しました`,
    recommended_works: works,
    winning_patterns: winningPatterns,
    own_account_gaps: ownAccountGaps,
    drafts: proposals,
    media_recommendations: mediaRecommendations,
    schedule_recommendations: scheduleRecommendations,
    risk_flags: riskFlags,
    confidence: Number(confidenceParts.reduce((s, v) => s + v, 0).toFixed(2)),
    reasons: [
      ...winningPatterns.slice(0, 3).map((pattern) => pattern.reason),
      ...works.slice(0, 3).map((work) => `${work.title}: ${work.reasons.slice(0, 3).join(' / ')}`),
      ...ownAccountGaps.slice(0, 3).map((gap) => gap.recommended_action),
    ],
  };
}
