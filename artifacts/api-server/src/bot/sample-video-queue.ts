import { filterContent } from './content-filter.js';
import { pickFanzaTemplate } from './fanza-templates.js';
import { getRunConfig } from './run-config.js';
import { enqueuePost, type QueueItem } from './post-queue.js';
import { recordAnalytics } from './post-analytics.js';
import {
  checkSampleVideoPermission,
  prepareSampleVideoClip,
  createSlideshowVideo,
  type ClipMp4Result,
  type PreparedSampleVideo,
  type SampleVideoPermission,
} from './sample-video.js';
import { getSampleImages } from './fanza.js';
import { sendEmailNotification } from './email-notifier.js';

export interface QueueSampleVideoPostOptions {
  text?: string;
  startSec?: number;
  durationSec?: number;
  notifyEmail?: string;
  fallbackToImages?: boolean;
}

export interface QueueSampleVideoPostResult {
  queueItem: QueueItem;
  clip?: PreparedSampleVideo;
  permission: SampleVideoPermission;
  email: { ok: boolean; skipped?: boolean; error?: string };
  usedImageFallback?: boolean;
  fallbackReason?: string;
}

export interface QueueManualClipPostOptions {
  text?: string;
  title?: string;
  affiliateUrl?: string;
  sourceUrl?: string;
  source?: 'discord' | 'dashboard' | 'api';
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
  const fallbackToImages = opts.fallbackToImages === true;
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

  const sourceUrl = item.content_id ?? item.id ?? '';
  const safetyScore = Math.max(0, 100 - (filterResult.blockedWords?.length ?? 0) * 20);
  const durationSec = Number(opts.durationSec ?? 8);

  // ① 動画（直接ストリーム → スライドショーの順で自動フォールバック）
  let clip: PreparedSampleVideo | undefined;
  let videoError: string | undefined;

  try {
    clip = await prepareSampleVideoClip(item, {
      startSec: Number(opts.startSec ?? 3),
      durationSec,
    });
  } catch (e1: any) {
    // prepareSampleVideoClip が直接+スライドショー両方失敗した場合のみここに到達
    // スライドショーを単独で再試行（念のため）
    try {
      clip = await createSlideshowVideo(item, { durationSec });
    } catch (e2: any) {
      videoError = `直接動画: ${e1?.message ?? e1} / スライドショー: ${e2?.message ?? e2}`;
    }
  }

  // ② 動画が完全に取得できない場合 → 静止画フォールバック
  let queueItem: QueueItem;
  let usedImageFallback = false;
  let fallbackReason: string | undefined;

  if (clip) {
    queueItem = enqueuePost({
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
  } else if (fallbackToImages) {
    usedImageFallback = true;
    fallbackReason = videoError;
    const images = getSampleImages(item);
    const imageUrl = images[0];
    if (!imageUrl) {
      throw new Error(`動画・スライドショー・画像いずれも取得できませんでした。エラー: ${videoError ?? 'unknown'}`);
    }
    queueItem = enqueuePost({
      type: 'fanza',
      text,
      itemTitle: item.title,
      affiliateUrl: item.affiliateURL ?? undefined,
      sourceUrl,
      imageUrl,
      templateType: 'sample-video',
      templateCategory: 'other',
      filterResult,
      safetyScore,
    });
  } else {
    throw new Error(videoError ?? '動画の取得に失敗しました');
  }

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

  const methodLabel = usedImageFallback ? '静止画' : clip?.method === 'slideshow' ? 'スライドショー動画' : '動画';
  const emailSubject = usedImageFallback
    ? 'FANZA投稿キュー作成（静止画フォールバック）'
    : clip?.method === 'slideshow'
      ? 'FANZAスライドショー動画キュー作成完了'
      : 'FANZAサンプル動画キュー作成完了';
  const emailBody = usedImageFallback
    ? `動画・スライドショー取得に失敗したため、静止画で代替投稿をキューに追加しました。\n\n作品: ${item.title}\nqueue_id: ${queueItem.id}\nエラー: ${fallbackReason}`
    : `${methodLabel}付き投稿をキューに追加しました。\n\n作品: ${item.title}\nqueue_id: ${queueItem.id}\n動画: ${clip!.url}`;

  const notifyTo = String(opts.notifyEmail || process.env.SAMPLE_VIDEO_NOTIFY_EMAIL || '').trim();
  const email = notifyTo
    ? await sendEmailNotification({ to: notifyTo, subject: emailSubject, text: emailBody })
    : { ok: false, skipped: true, error: '通知先未指定' };

  return { queueItem, clip, permission, email, usedImageFallback, fallbackReason };
}

export function queueManualClipPost(
  clip: ClipMp4Result,
  opts: QueueManualClipPostOptions = {},
): QueueItem {
  const title = String(opts.title || clip.filename.replace(/\.mp4$/i, '') || '動画クリップ').trim();
  const affiliateUrl = String(opts.affiliateUrl || '').trim();
  const sourceUrl = String(opts.sourceUrl || affiliateUrl || `manual-clip:${clip.filename}`).trim();
  const text = String(opts.text || '').trim() || (
    affiliateUrl
      ? `${title}\n\n気になる方はリプ欄へ👇`
      : title
  );

  const filterResult = filterContent(text, getRunConfig().safetyStrictness);
  if (!filterResult.safe) {
    throw new Error(filterResult.reason ?? 'コンテンツフィルターで除外');
  }

  const safetyScore = Math.max(0, 100 - (filterResult.blockedWords?.length ?? 0) * 20);
  const queueItem = enqueuePost({
    type: affiliateUrl ? 'fanza' : 'engagement',
    text,
    itemTitle: title,
    affiliateUrl: affiliateUrl || undefined,
    sourceUrl,
    mediaFiles: [{ filename: clip.filename, url: clip.url, type: 'video/mp4' }],
    templateType: 'manual-video-clip',
    templateCategory: 'other',
    filterResult,
    safetyScore,
  });

  recordAnalytics({
    postId: queueItem.id,
    postedAt: queueItem.createdAt,
    provider: 'twitter',
    productId: sourceUrl,
    productTitle: title,
    category: queueItem.type,
    templateType: 'manual-video-clip',
    templateCategory: 'other',
    text,
    url: affiliateUrl,
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

  return queueItem;
}
