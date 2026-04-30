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
import { uploadImages, postTweet, replyToTweet } from './twitter.js';
import { resolveShortUrl } from './rebrandly.js';
import { recordPostEvent, validatePost } from './safety-engine.js';

export interface PublishQueueResult {
  ok: boolean;
  item: QueueItem | null;
  tweetId?: string;
  replyId?: string;
  dryRun?: boolean;
  skipped?: boolean;
  error?: string;
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
  const raw =
    process.env.PUBLIC_BASE_URL ??
    process.env.APP_URL ??
    process.env.REPLIT_DEPLOYMENT_DOMAIN ??
    process.env.REPLIT_DEV_DOMAIN ??
    null;
  if (!raw) return null;
  return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
}

function mediaUrlsFor(item: QueueItem): string[] {
  const urls: string[] = [];
  if (item.imageUrl) urls.push(item.imageUrl);
  const base = publicBaseUrl();
  for (const media of item.mediaFiles ?? []) {
    if (!media.url) continue;
    if (media.url.startsWith('http://') || media.url.startsWith('https://')) {
      urls.push(media.url);
    } else if (base && media.url.startsWith('/')) {
      urls.push(new URL(media.url, base).toString());
    }
  }
  return urls.slice(0, 4);
}

async function buildPostText(item: QueueItem): Promise<{ text: string; replyText?: string; shortUrl?: string }> {
  let text = fitTweetText(item.text);
  if (!item.affiliateUrl) return { text };

  const shortUrl = await resolveShortUrl(
    item.affiliateUrl,
    item.sourceUrl ?? item.id,
    item.itemTitle ?? item.type,
  );

  if (text.includes(item.affiliateUrl)) {
    text = fitTweetText(text.replaceAll(item.affiliateUrl, shortUrl));
    return { text, shortUrl };
  }

  if (text.includes(shortUrl)) return { text, shortUrl };

  if (item.type === 'myfans' && !/https?:\/\//.test(text) && `${text}\n${shortUrl}`.length <= 280) {
    return { text: `${text}\n${shortUrl}`, shortUrl };
  }

  return { text, replyText: `作品ページはこちら\n${shortUrl}`, shortUrl };
}

export async function approveAndPostQueueItem(id: string): Promise<PublishQueueResult> {
  if (publishing) {
    return { ok: false, item: getQueueItem(id) ?? null, skipped: true, error: '別のキュー投稿が進行中です' };
  }

  const current = getQueueItem(id);
  if (!current) return { ok: false, item: null, error: 'キューアイテムが見つかりません' };
  if (current.status === 'posted' || current.status === 'dry_run') {
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
    const validation = validatePost(isAffiliate);
    if (!validation.allowed) {
      const message = `安全制限: ${validation.errors.join(', ')}`;
      markFailed(item.id, message);
      return { ok: false, item: getQueueItem(item.id) ?? item, error: message };
    }

    const { text, replyText } = await buildPostText(item);
    const filterResult = filterContent(text, getRunConfig().safetyStrictness);
    if (!filterResult.safe) {
      const message = `コンテンツフィルター: ${filterResult.reason ?? 'blocked'}`;
      markFailed(item.id, message);
      return { ok: false, item: getQueueItem(item.id) ?? item, error: message };
    }

    if (isDryRun()) {
      markPosted(item.id, 'dry_run');
      return { ok: true, item: getQueueItem(item.id) ?? item, tweetId: 'dry_run', dryRun: true };
    }

    const mediaIds = await uploadImages(mediaUrlsFor(item));
    const tweetId = await postTweet(text, mediaIds);
    let replyId = '';
    if (replyText) {
      replyId = await replyToTweet(tweetId, replyText);
    }

    markPosted(item.id, tweetId);
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
    const message = e?.message ?? String(e);
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
