import {
  approveQueueItem,
  getQueue,
  getQueueItem,
  markFailed,
  markPosted,
  type QueueItem,
} from './post-queue.js';
import { filterContent } from './content-filter.js';
import { getRunConfig, isDryRun } from './run-config.js';
import { recordPost } from './storage.js';
import { uploadImages, uploadLocalMediaFile, postTweet, replyToTweet } from './twitter.js';
import { resolveShortUrl } from './rebrandly.js';
import { recordPostEvent, validatePost } from './safety-engine.js';
import { pickAffiliateReplyCopy, recordAnalytics } from './post-analytics.js';
import { getSampleVideoFilePath } from './sample-video.js';

export interface PublishQueueResult {
  ok: boolean;
  item: QueueItem | null;
  tweetId?: string;
  replyId?: string;
  dryRun?: boolean;
  skipped?: boolean;
  error?: string;
}

export interface PublishQueueOptions {
  forceLive?: boolean;
  bypassSafetyLimits?: boolean;
  source?: 'discord' | 'dashboard' | 'scheduler' | 'api';
}

let publishing = false;

function isAffiliateItem(item: QueueItem): boolean {
  return Boolean(item.affiliateUrl) || item.type === 'fanza' || item.type === 'myfans' || item.type === 'emergency';
}

function fitTweetText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= 280 ? trimmed : `${trimmed.slice(0, 277)}...`;
}

function publicBaseUrl(): string | null {
  const rawValue =
    process.env.PUBLIC_BASE_URL ??
    process.env.APP_URL ??
    process.env.REPLIT_DEPLOYMENT_DOMAIN ??
    process.env.REPLIT_DEV_DOMAIN ??
    process.env.REPLIT_DOMAINS ??
    null;
  const raw = rawValue?.split(',')[0]?.trim() ?? null;
  if (!raw) return null;
  return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
}

async function uploadQueueMedia(item: QueueItem): Promise<string[]> {
  const ids: string[] = [];
  if (item.imageUrl) ids.push(...await uploadImages([item.imageUrl]));

  const remoteUrls: string[] = [];
  const base = publicBaseUrl();
  let videoMediaCount = 0;
  let uploadedVideoCount = 0;
  for (const media of item.mediaFiles ?? []) {
    const isVideo = media.type.startsWith('video/');
    if (isVideo) videoMediaCount++;
    const localPath = media.filename ? getSampleVideoFilePath(media.filename) : null;
    if (localPath) {
      try {
        ids.push(await uploadLocalMediaFile(localPath, media.type));
        if (isVideo) uploadedVideoCount++;
      } catch (e: any) {
        console.error(`  ⚠ ローカルメディアアップロード失敗 (${media.filename}): ${e.message}`);
      }
      continue;
    }

    if (!media.url) continue;
    if (media.url.startsWith('http://') || media.url.startsWith('https://')) {
      remoteUrls.push(media.url);
    } else if (base && media.url.startsWith('/')) {
      remoteUrls.push(new URL(media.url, base).toString());
    }
  }

  if (remoteUrls.length > 0) {
    const before = ids.length;
    ids.push(...await uploadImages(remoteUrls));
    uploadedVideoCount += Math.max(0, ids.length - before);
  }
  if (videoMediaCount > 0 && uploadedVideoCount === 0) {
    throw new Error('サンプル動画のアップロードに失敗したため、動画なし投稿を中止しました');
  }
  return ids.slice(0, 4);
}

function removeUrls(text: string, urls: string[]): string {
  let cleaned = text;
  for (const url of urls.filter(Boolean)) {
    cleaned = cleaned.replaceAll(url, '');
  }
  cleaned = cleaned.replace(/https?:\/\/\S+/g, '');
  return cleaned.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function shouldPutAffiliateLinkInReply(item: QueueItem): boolean {
  return item.type === 'fanza' || item.templateType === 'sample-video';
}

async function buildPostText(item: QueueItem): Promise<{ text: string; replyText?: string; shortUrl?: string; linkReplyVariant?: string }> {
  let text = fitTweetText(item.text);
  if (!item.affiliateUrl) return { text };

  const shortUrl = await resolveShortUrl(
    item.affiliateUrl,
    item.sourceUrl ?? item.id,
    item.itemTitle ?? item.type,
  );

  if (shouldPutAffiliateLinkInReply(item)) {
    const linkReply = pickAffiliateReplyCopy(shortUrl);
    return {
      text: fitTweetText(removeUrls(text, [item.affiliateUrl, shortUrl])),
      replyText: linkReply.text,
      shortUrl,
      linkReplyVariant: linkReply.variant,
    };
  }

  if (text.includes(item.affiliateUrl)) {
    text = fitTweetText(text.replaceAll(item.affiliateUrl, shortUrl));
    return { text, shortUrl };
  }

  if (text.includes(shortUrl)) return { text, shortUrl };

  if (item.type === 'myfans' && !/https?:\/\//.test(text) && `${text}\n${shortUrl}`.length <= 280) {
    return { text: `${text}\n${shortUrl}`, shortUrl };
  }

  const linkReply = pickAffiliateReplyCopy(shortUrl);
  return { text, replyText: linkReply.text, shortUrl, linkReplyVariant: linkReply.variant };
}

function formatPublishError(e: any): string {
  const code = e?.code ?? e?.status ?? e?.statusCode;
  const detail = e?.data?.detail ?? e?.errors?.[0]?.message ?? e?.data?.errors?.[0]?.message;
  const message = e?.message ?? String(e);
  return [code ? `HTTP ${code}` : '', message, detail && detail !== message ? detail : ''].filter(Boolean).join(' | ');
}

export async function approveAndPostQueueItem(
  id: string,
  options: PublishQueueOptions = {},
): Promise<PublishQueueResult> {
  if (publishing) {
    return { ok: false, item: getQueueItem(id) ?? null, skipped: true, error: '別のキュー投稿が進行中です' };
  }

  const current = getQueueItem(id);
  if (!current) return { ok: false, item: null, error: 'キューアイテムが見つかりません' };
  if (current.status === 'posted' || (current.status === 'dry_run' && !options.forceLive)) {
    return { ok: true, item: current, skipped: true, tweetId: current.tweetId, dryRun: current.status === 'dry_run' };
  }
  if (current.status === 'rejected' || current.status === 'failed') {
    return { ok: false, item: current, skipped: true, error: `投稿できないステータスです: ${current.status}` };
  }

  const item = current.status === 'pending'
    ? approveQueueItem(id)
    : current;
  if (!item) return { ok: false, item: null, error: '承認に失敗しました' };

  publishing = true;
  try {
    const isAffiliate = isAffiliateItem(item);
    if (!options.bypassSafetyLimits) {
      const validation = validatePost(isAffiliate);
      if (!validation.allowed) {
        const message = `安全制限: ${validation.errors.join(', ')}`;
        markFailed(item.id, message);
        return { ok: false, item: getQueueItem(item.id) ?? item, error: message };
      }
    } else {
      console.warn(`  ⚠ [Queue] 手動投稿のため安全制限をスキップ: id=${item.id} source=${options.source ?? 'unknown'}`);
    }

    const { text, replyText, shortUrl, linkReplyVariant } = await buildPostText(item);
    const filterResult = filterContent(text, getRunConfig().safetyStrictness);
    if (!filterResult.safe) {
      const message = `コンテンツフィルター: ${filterResult.reason ?? 'blocked'}`;
      markFailed(item.id, message);
      return { ok: false, item: getQueueItem(item.id) ?? item, error: message };
    }

    const dryRun = !options.forceLive && isDryRun();
    if (dryRun) {
      markPosted(item.id, 'dry_run', 'dry_run');
      return { ok: true, item: getQueueItem(item.id) ?? item, tweetId: 'dry_run', dryRun: true };
    }

    const mediaIds = await uploadQueueMedia(item);
    const tweetId = await postTweet(text, mediaIds);
    let replyId = '';
    if (replyText) {
      replyId = await replyToTweet(tweetId, replyText);
    }

    markPosted(item.id, tweetId, 'posted');
    recordAnalytics({
      postId: tweetId,
      postedAt: new Date().toISOString(),
      provider: 'twitter',
      productId: item.sourceUrl ?? '',
      productTitle: item.itemTitle ?? item.type,
      category: item.type,
      templateType: item.templateType ?? item.type,
      templateCategory: item.templateCategory ?? (item.type === 'erotic-story' ? 'erotic-story' : item.type === 'engagement' ? 'engagement' : 'other'),
      text,
      url: item.affiliateUrl ?? '',
      shortUrl: shortUrl ?? '',
      linkReplyVariant,
      imageUsed: mediaIds.length > 0,
      safetyScore: item.safetyScore ?? 100,
      result: 'posted',
      clicks: 0,
      impressions: 0,
      likes: 0,
      reposts: 0,
      replies: 0,
      metricsUpdatedAt: null,
    });
    recordPost({
      tweetId,
      replyId,
      text,
      type: item.type,
      item: {
        content_id: item.sourceUrl ?? item.id,
        title: item.itemTitle ?? item.type,
        affiliateURL: item.affiliateUrl ?? '',
      },
      imagePrompt: item.imagePrompt ?? null,
    });
    recordPostEvent(isAffiliate);

    return { ok: true, item: getQueueItem(item.id) ?? item, tweetId, replyId };
  } catch (e: any) {
    const message = formatPublishError(e);
    markFailed(item.id, message);
    return { ok: false, item: getQueueItem(item.id) ?? item, error: message };
  } finally {
    publishing = false;
  }
}

export async function processApprovedQueue(limit = 1): Promise<PublishQueueResult[]> {
  const approved = getQueue(['approved']).slice(0, limit);
  const results: PublishQueueResult[] = [];
  for (const item of approved) {
    results.push(await approveAndPostQueueItem(item.id));
  }
  return results;
}
