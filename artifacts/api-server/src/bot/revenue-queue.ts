import { autoCreateRebrandlyLinks } from './rebrandly.js';
import { filterContent } from './content-filter.js';
import { getRevenueOptimizedItems, getSampleImages, scoreFanzaItem } from './fanza.js';
import { pickFanzaTemplate } from './fanza-templates.js';
import { enqueuePost, getQueue } from './post-queue.js';
import { recordAnalytics } from './post-analytics.js';
import { getRunConfig } from './run-config.js';

export interface RevenueQueueOptions {
  count?: number;
  keyword?: string;
  withImage?: boolean;
  createRebrandly?: boolean;
  source?: 'manual' | 'dashboard' | 'discord' | 'scheduler';
}

export interface RevenueQueueItemResult {
  ok: boolean;
  queueId?: string;
  content_id?: string;
  title?: string;
  revenueScore?: ReturnType<typeof scoreFanzaItem>;
  templateCategory?: string;
  error?: string;
}

export interface RevenueBoosterPackResult {
  ok: boolean;
  requested: number;
  queuedCount: number;
  items: Array<{
    ok: boolean;
    content_id?: string;
    title?: string;
    engagementQueueId?: string;
    revenueQueueId?: string;
    error?: string;
  }>;
  source: RevenueQueueOptions['source'];
}

function normalizeManualFanzaItem(rawItem: any): any {
  return {
    ...rawItem,
    title: rawItem?.title ?? '',
    content_id: rawItem?.content_id ?? rawItem?.id ?? '',
    affiliateURL: rawItem?.affiliateURL ?? rawItem?.affiliateUrl ?? '',
    review: rawItem?.review ?? { count: rawItem?.reviewCount ?? 0, average: rawItem?.reviewAvg ?? '4.0' },
    iteminfo: {
      ...(rawItem?.iteminfo ?? {}),
      actress: rawItem?.iteminfo?.actress ?? (Array.isArray(rawItem?.actress) ? rawItem.actress.map((name: string) => ({ name })) : []),
      genre: rawItem?.iteminfo?.genre ?? (Array.isArray(rawItem?.genre) ? rawItem.genre.map((name: string) => ({ name })) : []),
      maker: rawItem?.iteminfo?.maker ?? (Array.isArray(rawItem?.makers) ? rawItem.makers.map((name: string) => ({ name })) : []),
    },
    imageURL: rawItem?.imageURL ?? {
      large: rawItem?.thumbnail ?? rawItem?.imageUrl ?? null,
      small: rawItem?.thumbnail ?? rawItem?.imageUrl ?? null,
    },
    sampleImageURL: rawItem?.sampleImageURL ?? (Array.isArray(rawItem?.sampleImages)
      ? { sample_l: { image: rawItem.sampleImages } }
      : undefined),
  };
}

function pickPrimaryGenre(item: any): string {
  const genres = item?.iteminfo?.genre ?? item?.genre ?? [];
  if (!Array.isArray(genres)) return '';
  return genres
    .map((g: any) => typeof g === 'string' ? g : g?.name ?? '')
    .filter(Boolean)[0] ?? '';
}

function pickPrimaryActress(item: any): string {
  const actresses = item?.iteminfo?.actress ?? item?.actress ?? [];
  if (!Array.isArray(actresses)) return '';
  return actresses
    .map((a: any) => typeof a === 'string' ? a : a?.name ?? '')
    .filter(Boolean)[0] ?? '';
}

function trimTitle(title: string, max = 34): string {
  return title.length > max ? `${title.slice(0, max)}...` : title;
}

function buildEngagementBridgeText(item: any): string {
  const genre = pickPrimaryGenre(item);
  const actress = pickPrimaryActress(item);
  const title = trimTitle(String(item.title ?? '気になる作品'));
  const reviewCount = Number(item.review?.count ?? item.reviewCount ?? 0);
  const reviewAvg = item.review?.average ?? item.reviewAvg ?? '';
  const hooks = [
    `🔞今日どれ見るか迷う\n\n${genre ? `${genre}系で` : ''}レビューが伸びてる作品を見つけたんだけど、こういうの好きな人いますか？\n\n反応あればこのあとリンク置きます`,
    `🔞今夜の候補\n\n${actress ? `${actress}さん` : '気になる女優さん'}の「${title}」\n${reviewCount ? `レビュー${reviewCount}件` : 'レビューあり'}${reviewAvg ? ` / 評価${reviewAvg}` : ''}\n\n見たい人だけ反応ください`,
    `🔞正直、こういう作品が一番クリックされる気がしてる\n\n${genre ? `${genre}系` : '王道系'} / ${reviewCount ? `レビュー${reviewCount}件` : 'レビューあり'}\n\n気になる人いたら次で出します`,
  ];
  return hooks[Math.floor(Math.random() * hooks.length)];
}

export async function queueSingleFanzaItem(
  rawItem: any,
  opts: { text?: string; withImage?: boolean; createRebrandly?: boolean; source?: RevenueQueueOptions['source'] } = {},
) {
  const item = normalizeManualFanzaItem(rawItem);
  const sourceUrl = item.content_id ?? item.id ?? '';
  if (!item.title || !item.affiliateURL) {
    throw new Error('FANZA作品情報またはアフィリエイトURLが不足しています');
  }
  const exists = getQueue(['pending', 'approved']).some(
    (queueItem) => queueItem.type === 'fanza' && queueItem.sourceUrl === sourceUrl,
  );
  if (exists) {
    throw new Error('この作品は既にキューにあります');
  }

  const tmpl = opts.text?.trim()
    ? { text: opts.text.trim(), templateType: 'manual-selected', templateCategory: 'review' as const }
    : pickFanzaTemplate(item, 'revenue');
  const filterResult = filterContent(tmpl.text, getRunConfig().safetyStrictness);
  if (!filterResult.safe) {
    throw new Error(filterResult.reason ?? 'コンテンツフィルターで除外');
  }

  const safetyScore = Math.max(0, 100 - (filterResult.blockedWords?.length ?? 0) * 20);
  const imageUrl = opts.withImage !== false ? getSampleImages(item)[0] ?? undefined : undefined;
  const queueItem = enqueuePost({
    type: 'fanza',
    text: tmpl.text,
    itemTitle: item.title,
    affiliateUrl: item.affiliateURL,
    imageUrl,
    sourceUrl,
    templateType: tmpl.templateType,
    templateCategory: tmpl.templateCategory,
    safetyScore,
    filterResult,
  });

  recordAnalytics({
    postId: queueItem.id,
    postedAt: queueItem.createdAt,
    provider: 'twitter',
    productId: sourceUrl,
    productTitle: item.title,
    category: 'fanza',
    templateType: tmpl.templateType,
    templateCategory: tmpl.templateCategory,
    text: tmpl.text,
    url: item.affiliateURL,
    shortUrl: '',
    imageUsed: Boolean(imageUrl),
    safetyScore,
    result: 'queued',
    clicks: 0,
    impressions: 0,
    likes: 0,
    reposts: 0,
    replies: 0,
    metricsUpdatedAt: null,
  });

  const rebrandly = opts.createRebrandly !== false && process.env.REBRANDLY_API_KEY
    ? await autoCreateRebrandlyLinks([{ affiliateUrl: item.affiliateURL, itemId: sourceUrl, title: item.title }])
    : null;

  return {
    ok: true,
    queueItem,
    queuedCount: 1,
    rebrandly,
    source: opts.source ?? 'manual',
  };
}

export async function queueRevenueOptimizedItems(opts: RevenueQueueOptions = {}) {
  const count = Math.min(Math.max(Number(opts.count) || 3, 1), 10);
  const keyword = opts.keyword?.trim() || undefined;
  const withImage = opts.withImage !== false;
  const items = await getRevenueOptimizedItems(Math.max(count * 2, 10), keyword);
  const activeSourceUrls = new Set(
    getQueue(['pending', 'approved'])
      .filter((queueItem) => queueItem.type === 'fanza' && queueItem.sourceUrl)
      .map((queueItem) => queueItem.sourceUrl),
  );
  const queued: RevenueQueueItemResult[] = [];
  const rebrandlyCandidates: Array<{ affiliateUrl?: string; itemId?: string; title?: string }> = [];

  for (const item of items) {
    if (queued.filter(i => i.ok).length >= count) break;
    const sourceUrl = item.content_id ?? item.id;
    if (sourceUrl && activeSourceUrls.has(sourceUrl)) {
      queued.push({
        ok: false,
        content_id: item.content_id,
        title: item.title,
        error: '既にキューにあります',
      });
      continue;
    }

    const tmpl = pickFanzaTemplate(item, 'revenue');
    const filterResult = filterContent(tmpl.text, getRunConfig().safetyStrictness);
    if (!filterResult.safe) {
      queued.push({
        ok: false,
        content_id: item.content_id,
        title: item.title,
        error: filterResult.reason ?? 'コンテンツフィルターで除外',
      });
      continue;
    }

    const safetyScore = Math.max(0, 100 - (filterResult.blockedWords?.length ?? 0) * 20);
    const imageUrl = withImage ? getSampleImages(item)[0] ?? undefined : undefined;
    const queueItem = enqueuePost({
      type: 'fanza',
      text: tmpl.text,
      itemTitle: item.title,
      affiliateUrl: item.affiliateURL ?? undefined,
      imageUrl,
      sourceUrl,
      templateType: tmpl.templateType,
      templateCategory: tmpl.templateCategory,
      safetyScore,
      filterResult,
    });

    recordAnalytics({
      postId: queueItem.id,
      postedAt: queueItem.createdAt,
      provider: 'twitter',
      productId: item.content_id ?? item.id ?? '',
      productTitle: item.title ?? '',
      category: 'fanza',
      templateType: tmpl.templateType,
      templateCategory: tmpl.templateCategory,
      text: tmpl.text,
      url: item.affiliateURL ?? '',
      shortUrl: '',
      imageUsed: Boolean(imageUrl),
      safetyScore,
      result: 'queued',
      clicks: 0,
      impressions: 0,
      likes: 0,
      reposts: 0,
      replies: 0,
      metricsUpdatedAt: null,
    });

    queued.push({
      ok: true,
      queueId: queueItem.id,
      content_id: item.content_id,
      title: item.title,
      revenueScore: item.revenueScore ?? scoreFanzaItem(item),
      templateCategory: tmpl.templateCategory,
    });
    rebrandlyCandidates.push({ affiliateUrl: item.affiliateURL, itemId: sourceUrl, title: item.title });
    if (sourceUrl) activeSourceUrls.add(sourceUrl);
  }

  const rebrandly = opts.createRebrandly !== false && process.env.REBRANDLY_API_KEY
    ? await autoCreateRebrandlyLinks(rebrandlyCandidates)
    : null;

  return {
    ok: true,
    requested: count,
    queuedCount: queued.filter(i => i.ok).length,
    items: queued,
    rebrandly,
    source: opts.source ?? 'manual',
  };
}

export async function queueRevenueBoosterPack(opts: RevenueQueueOptions = {}): Promise<RevenueBoosterPackResult> {
  const count = Math.min(Math.max(Number(opts.count) || 2, 1), 5);
  const keyword = opts.keyword?.trim() || undefined;
  const items = await getRevenueOptimizedItems(Math.max(count * 3, 10), keyword);
  const activeSourceUrls = new Set(
    getQueue(['pending', 'approved'])
      .filter((queueItem) => queueItem.sourceUrl)
      .map((queueItem) => queueItem.sourceUrl),
  );
  const results: RevenueBoosterPackResult['items'] = [];

  for (const item of items) {
    if (results.filter(i => i.ok).length >= count) break;
    const normalized = normalizeManualFanzaItem(item);
    const sourceUrl = normalized.content_id ?? normalized.id ?? '';
    if (!sourceUrl || activeSourceUrls.has(sourceUrl)) {
      results.push({ ok: false, content_id: sourceUrl, title: normalized.title, error: '既にキューにあります' });
      continue;
    }

    try {
      const bridgeText = buildEngagementBridgeText(normalized);
      const bridgeFilter = filterContent(bridgeText, getRunConfig().safetyStrictness);
      if (!bridgeFilter.safe) throw new Error(bridgeFilter.reason ?? '導入投稿がフィルターで除外');

      const engagementItem = enqueuePost({
        type: 'engagement',
        text: bridgeText,
        itemTitle: `導入: ${normalized.title}`,
        sourceUrl,
        templateType: 'revenue-bridge',
        templateCategory: 'engagement',
        filterResult: bridgeFilter,
        safetyScore: Math.max(0, 100 - (bridgeFilter.blockedWords?.length ?? 0) * 20),
      });

      recordAnalytics({
        postId: engagementItem.id,
        postedAt: engagementItem.createdAt,
        provider: 'twitter',
        productId: sourceUrl,
        productTitle: normalized.title,
        category: 'engagement',
        templateType: 'revenue-bridge',
        templateCategory: 'engagement',
        text: bridgeText,
        url: '',
        shortUrl: '',
        imageUsed: false,
        safetyScore: engagementItem.safetyScore ?? 100,
        result: 'queued',
        clicks: 0,
        impressions: 0,
        likes: 0,
        reposts: 0,
        replies: 0,
        metricsUpdatedAt: null,
      });

      const revenue = await queueSingleFanzaItem(normalized, {
        withImage: opts.withImage !== false,
        createRebrandly: opts.createRebrandly,
        source: opts.source,
      });

      results.push({
        ok: true,
        content_id: sourceUrl,
        title: normalized.title,
        engagementQueueId: engagementItem.id,
        revenueQueueId: revenue.queueItem.id,
      });
      activeSourceUrls.add(sourceUrl);
    } catch (e: any) {
      results.push({ ok: false, content_id: sourceUrl, title: normalized.title, error: e.message ?? String(e) });
    }
  }

  return {
    ok: true,
    requested: count,
    queuedCount: results.filter(i => i.ok).length * 2,
    items: results,
    source: opts.source ?? 'manual',
  };
}
