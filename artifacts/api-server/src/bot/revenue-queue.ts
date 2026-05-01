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
