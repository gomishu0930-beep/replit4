import { filterContent } from './content-filter.js';
import { pickFanzaTemplate } from './fanza-templates.js';
import { getRunConfig } from './run-config.js';
import { enqueuePost, type QueueItem } from './post-queue.js';
import { recordAnalytics } from './post-analytics.js';
import {
  checkSampleVideoPermission,
  prepareSampleVideoClip,
  type PreparedSampleVideo,
  type SampleVideoPermission,
} from './sample-video.js';
import { sendEmailNotification } from './email-notifier.js';

export interface QueueSampleVideoPostOptions {
  text?: string;
  startSec?: number;
  durationSec?: number;
  notifyEmail?: string;
}

export interface QueueSampleVideoPostResult {
  queueItem: QueueItem;
  clip: PreparedSampleVideo;
  permission: SampleVideoPermission;
  email: { ok: boolean; skipped?: boolean; error?: string };
}

export function normalizeFanzaItemForVideo(rawItem: any): any {
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
    sampleMovieURL: rawItem?.sampleMovieURL ?? rawItem?.sampleMovieUrl,
  };
}

export async function queueSampleVideoPost(
  rawItem: any,
  opts: QueueSampleVideoPostOptions = {},
): Promise<QueueSampleVideoPostResult> {
  const item = normalizeFanzaItemForVideo(rawItem);
  const permission = checkSampleVideoPermission(item);
  if (!permission.allowed) {
    throw new Error(permission.reason);
  }

  const text = String(opts.text ?? '').trim() || pickFanzaTemplate(item, 'revenue').text;
  const filterResult = filterContent(text, getRunConfig().safetyStrictness);
  if (!filterResult.safe) {
    throw new Error(filterResult.reason ?? 'コンテンツフィルターで除外');
  }

  const clip = await prepareSampleVideoClip(item, {
    startSec: Number(opts.startSec ?? 3),
    durationSec: Number(opts.durationSec ?? 8),
  });
  const sourceUrl = item.content_id ?? item.id ?? '';
  const safetyScore = Math.max(0, 100 - (filterResult.blockedWords?.length ?? 0) * 20);
  const queueItem = enqueuePost({
    type: 'fanza',
    text,
    itemTitle: item.title,
    affiliateUrl: item.affiliateURL ?? undefined,
    sourceUrl,
    mediaFiles: [{ filename: clip.filename, url: clip.url, type: 'video/mp4' }],
    templateType: 'sample-video',
    templateCategory: 'other',
    filterResult,
    safetyScore,
  });

  recordAnalytics({
    postId: queueItem.id,
    postedAt: queueItem.createdAt,
    provider: 'twitter',
    productId: sourceUrl,
    productTitle: item.title ?? '',
    category: 'fanza',
    templateType: 'sample-video',
    templateCategory: 'other',
    text,
    url: item.affiliateURL ?? '',
    shortUrl: '',
    imageUsed: true,
    safetyScore,
    result: 'queued',
    clicks: 0,
    impressions: 0,
    likes: 0,
    reposts: 0,
    replies: 0,
    metricsUpdatedAt: null,
  });

  const notifyTo = String(opts.notifyEmail || process.env.SAMPLE_VIDEO_NOTIFY_EMAIL || '').trim();
  const email = notifyTo
    ? await sendEmailNotification({
      to: notifyTo,
      subject: 'FANZAサンプル動画キュー作成完了',
      text: `サンプル動画付き投稿をキューに追加しました。\n\n作品: ${item.title}\nqueue_id: ${queueItem.id}\n動画: ${clip.url}`,
    })
    : { ok: false, skipped: true, error: '通知先未指定' };

  return { queueItem, clip, permission, email };
}
