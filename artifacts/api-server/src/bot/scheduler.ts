import cron from 'node-cron';
import Anthropic from '@anthropic-ai/sdk';

import { getRandomItems, getHighRatedItems, getSampleImages, discoverCampaignIds, getRevenueOptimizedItems } from './fanza.js';
import { uploadImages, postTweet, replyToTweet, getAccountInfo, getOwnRecentTweets } from './twitter.js';
import { generateTweetText, generateEngagementReply, generateImpressionTweet, generateEroticStoryTweet, buildManualPostFeedback } from './ai.js';
import { generateImage, buildImagePrompt } from './imageGen.js';
import { filterContent, filterImagePrompt } from './content-filter.js';
import { isAutoPostEnabled, isDryRun, getRunConfig } from './run-config.js';
import { enqueuePost, getQueue, markPosted, markFailed } from './post-queue.js';
import { processApprovedQueue } from './queue-publisher.js';
import { researchBuzzForItem } from './grok.js';
import { recordPost, recordPostManual, getTopPatterns, getExternalTopPatterns, getPostsAfter, getStats, recordAccountSnapshot, getLatestSnapshot, getRebrandlyData, getDailyImpressionSnapshots, recordManualFeedback } from './storage.js';
import { pickFanzaTemplate } from './fanza-templates.js';
import { recordAnalytics, loadAnalytics, getAnalytics, isHighRevenueHour, getRecommendedRevenueHours, pickAffiliateReplyCopy } from './post-analytics.js';
import { buildInsightContext, loadInsightMemory } from './insight-memory.js';
import { runWeeklyReview, loadWeeklyReviews } from './weekly-review.js';
import { autoCreateRebrandlyLinks, syncRebrandlyClicks, resolveShortUrl } from './rebrandly.js';
import { refreshExternalPatterns, checkShadowbanRecovery, refreshRecentMetrics } from './analytics.js';
import { loadStrategyConfig, evaluateAndAdapt, runDailyEvaluation, getMonitorIntervalMs, getStrategySummary } from './strategy.js';
import { startWatchdog, injectSchedulerHooks } from './watchdog.js';
import { autoCompleteTask } from './tasks.js';
import { queueRevenueOptimizedItems } from './revenue-queue.js';
import { validatePost, recordPostEvent, loadSafetyState, updateFollowerCount, getSafetyStatus } from './safety-engine.js';
import {
  appendPostLog,
  appendAccountMetrics,
  upsertHypotheses,
  initSheetHeaders,
  isSheetsConfigured,
} from './sheets-writer.js';

let isPosting = false;
let _postingStartedAt: number | null = null;

export function getIsPosting() { return isPosting; }
export function getPostingStartedAt() { return _postingStartedAt; }
export function forceResetIsPosting() {
  console.log('  [WATCHDOG] isPosting強制リセット');
  isPosting = false;
  _postingStartedAt = null;
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function randomSleep(minSec: number, maxSec: number) {
  const ms = (minSec + Math.random() * (maxSec - minSec)) * 1000;
  console.log(`  ⏳ ${Math.round(ms / 1000)}秒 待機中...`);
  return sleep(ms);
}

type ContentSlotType = 'engagement' | 'erotic-story' | 'fanza' | 'myfans';

function pickSlotType(): ContentSlotType {
  const rand = Math.random() * 100;
  if (isHighRevenueHour() && rand < 45) return 'fanza';
  if (rand < 40) return 'engagement';
  if (rand < 65) return 'erotic-story';
  if (rand < 90) return 'fanza';
  return 'myfans';
}

function isAutoRevenueQueueEnabled(): boolean {
  return process.env.AUTO_REVENUE_QUEUE_ENABLED === 'true';
}

async function autoFillRevenueQueue(label: string): Promise<void> {
  const activeFanzaCount = getQueue(['pending', 'approved']).filter(item => item.type === 'fanza').length;
  if (activeFanzaCount >= 2) {
    console.log(`  📬 [${label}] FANZAキューが十分あります (${activeFanzaCount}件)`);
    return;
  }
  const result = await queueRevenueOptimizedItems({
    count: Math.max(1, 2 - activeFanzaCount),
    withImage: true,
    source: 'scheduler',
  });
  console.log(`  📬 [${label}] 収益候補キュー投入: ${result.queuedCount}/${result.requested}件`);
  if (result.queuedCount > 0) {
    autoCompleteTask('daily-revenue-queue', 'daily').catch(() => {});
  }
}

async function postFanzaItem(item: any, type: string, label: string) {
  const validation = validatePost(true);
  if (!validation.allowed) {
    console.log(`  [${label}] 安全制限: ${validation.errors.join(', ')}`);
    return null;
  }

  const topPatterns = getTopPatterns(10);
  const externalPatterns = getExternalTopPatterns(10);
  const rawGenre = item.iteminfo?.genre ?? item.genre ?? [];
  const genres: string[] = Array.isArray(rawGenre)
    ? rawGenre.map((g: any) => typeof g === 'string' ? g : g?.name ?? '').filter(Boolean)
    : [];
  const grokResearch = await Promise.race([
    researchBuzzForItem(item.title, genres),
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Grok timeout 30s')), 30000)),
  ]).catch((e: any) => {
    console.warn(`  ⚠ [Scheduler] Grok調査スキップ: ${e.message}`);
    return '';
  });
  // テキスト生成：新7カテゴリテンプレート（自然な口調）を使用
  // Grok調査は引き続き実行するが、テキスト生成はpickFanzaTemplateで行う
  const tmpl = pickFanzaTemplate(item, type);
  const text = tmpl.text;
  const imagePrompt: string | null = null; // FANZAは商品画像を使用

  console.log(`  📝 [${label}] テンプレート: ${tmpl.templateType} (${tmpl.templateCategory})`);

  const filterResult = filterContent(text, getRunConfig().safetyStrictness);
  if (!filterResult.safe) {
    console.warn(`  🚫 [${label}] FANZAテキストフィルター: ${filterResult.reason}`);
    return null;
  }

  const safetyScore = Math.max(0, 100 - (filterResult.blockedWords?.length ?? 0) * 20);

  const queueItem = enqueuePost({
    type: 'fanza',
    text,
    imagePrompt: undefined,
    itemTitle: item.title,
    affiliateUrl: item.affiliateURL ?? undefined,
    sourceUrl: item.content_id ?? item.id,
    templateType: tmpl.templateType,
    templateCategory: tmpl.templateCategory,
    safetyScore,
    filterResult,
  });

  if (isDryRun()) {
    console.log(`  🧪 [${label}] DRY_RUN: FANZA投稿スキップ (${item.title?.slice(0, 30)})`);
    markPosted(queueItem.id, 'dry_run');
    recordAnalytics({
      postId: queueItem.id,
      postedAt: new Date().toISOString(),
      provider: 'twitter',
      productId: item.content_id ?? item.id ?? '',
      productTitle: item.title ?? '',
      category: 'fanza',
      templateType: tmpl.templateType,
      templateCategory: tmpl.templateCategory,
      text,
      url: item.affiliateURL ?? '',
      shortUrl: '',
      imageUsed: false,
      safetyScore,
      result: 'dry_run',
      clicks: 0, impressions: 0, likes: 0, reposts: 0, replies: 0,
      metricsUpdatedAt: null,
    });
    return null;
  }
  if (!isAutoPostEnabled()) {
    console.log(`  ⏸ [${label}] AUTO_POST無効: キューに追加済み (id=${queueItem.id})`);
    recordAnalytics({
      postId: queueItem.id,
      postedAt: new Date().toISOString(),
      provider: 'twitter',
      productId: item.content_id ?? item.id ?? '',
      productTitle: item.title ?? '',
      category: 'fanza',
      templateType: tmpl.templateType,
      templateCategory: tmpl.templateCategory,
      text,
      url: item.affiliateURL ?? '',
      shortUrl: '',
      imageUsed: false,
      safetyScore,
      result: 'queued',
      clicks: 0, impressions: 0, likes: 0, reposts: 0, replies: 0,
      metricsUpdatedAt: null,
    });
    return null;
  }

  const imageUrls = getSampleImages(item);
  const mediaIds = await uploadImages(imageUrls);
  const tweetId = await postTweet(text, mediaIds);

  await randomSleep(30, 90);

  const reviewAvg = parseFloat(item.review?.average ?? '0');
  const reviewCount = item.review?.count ?? 0;
  const isHighScore = reviewAvg >= 4.3 && reviewCount >= 25;
  const affiliateURL = await resolveShortUrl(
    item.affiliateURL ?? '',
    isHighScore ? (item.content_id ?? item.id) : undefined,
    isHighScore ? item.title : undefined,
  );
  const linkReply = pickAffiliateReplyCopy(affiliateURL);
  const replyId = await replyToTweet(tweetId, linkReply.text);

  await randomSleep(20, 60);
  const engagementText = generateEngagementReply(type);
  await replyToTweet(replyId, engagementText);

  markPosted(queueItem.id, tweetId);
  recordAnalytics({
    postId: tweetId,
    postedAt: new Date().toISOString(),
    provider: 'twitter',
    productId: item.content_id ?? item.id ?? '',
    productTitle: item.title ?? '',
    category: 'fanza',
    templateType: tmpl.templateType,
    templateCategory: tmpl.templateCategory,
    text,
    url: item.affiliateURL ?? '',
    shortUrl: affiliateURL,
    linkReplyVariant: linkReply.variant,
    imageUsed: imageUrls.length > 0,
    safetyScore,
    result: 'posted',
    clicks: 0, impressions: 0, likes: 0, reposts: 0, replies: 0,
    metricsUpdatedAt: null,
  });
  recordPost({ tweetId, replyId, item, text, type, imagePrompt });
  recordPostEvent(true);

  if (isSheetsConfigured()) {
    appendPostLog({
      postedAt: new Date().toISOString(),
      celebrity: '',
      itemTitle: item.title,
      tweetText: text,
      tweetId,
      postType: type,
    }).catch(() => {});
  }

  console.log(`  ✅ [${label}] FANZA投稿完了 (${tweetId})`);
  return tweetId;
}

async function postEngagementSlot(label: string) {
  const validation = validatePost(false);
  if (!validation.allowed) {
    console.log(`  [${label}] 安全制限: ${validation.errors.join(', ')}`);
    return;
  }

  const { text } = generateImpressionTweet(Math.random() < 0.3);

  const filterResult = filterContent(text, getRunConfig().safetyStrictness);
  if (!filterResult.safe) {
    console.warn(`  🚫 [${label}] コンテンツフィルター: ${filterResult.reason}`);
    return;
  }

  const queueItem = enqueuePost({ type: 'engagement', text, filterResult });
  const safetyScore = Math.max(0, 100 - (filterResult.blockedWords?.length ?? 0) * 20);

  if (isDryRun()) {
    console.log(`  🧪 [${label}] DRY_RUN: 投稿スキップ (text先頭: ${text.slice(0, 40)})`);
    markPosted(queueItem.id, 'dry_run');
    recordAnalytics({
      postId: queueItem.id, postedAt: new Date().toISOString(), provider: 'twitter',
      productId: '', productTitle: '(エンゲージメント)', category: 'engagement',
      templateType: 'engagement', templateCategory: 'engagement',
      text, url: '', shortUrl: '', imageUsed: false, safetyScore,
      result: 'dry_run', clicks: 0, impressions: 0, likes: 0, reposts: 0, replies: 0, metricsUpdatedAt: null,
    });
    return;
  }
  if (!isAutoPostEnabled()) {
    console.log(`  ⏸ [${label}] AUTO_POST無効: キューに追加済み (id=${queueItem.id})`);
    recordAnalytics({
      postId: queueItem.id, postedAt: new Date().toISOString(), provider: 'twitter',
      productId: '', productTitle: '(エンゲージメント)', category: 'engagement',
      templateType: 'engagement', templateCategory: 'engagement',
      text, url: '', shortUrl: '', imageUsed: false, safetyScore,
      result: 'queued', clicks: 0, impressions: 0, likes: 0, reposts: 0, replies: 0, metricsUpdatedAt: null,
    });
    return;
  }

  try {
    const tweetId = await postTweet(text, []);
    markPosted(queueItem.id, tweetId);
    recordPost({ tweetId, replyId: '', text, type: 'engagement' });
    recordPostEvent(false);
    recordAnalytics({
      postId: tweetId, postedAt: new Date().toISOString(), provider: 'twitter',
      productId: '', productTitle: '(エンゲージメント)', category: 'engagement',
      templateType: 'engagement', templateCategory: 'engagement',
      text, url: '', shortUrl: '', imageUsed: false, safetyScore,
      result: 'posted', clicks: 0, impressions: 0, likes: 0, reposts: 0, replies: 0, metricsUpdatedAt: null,
    });
    console.log(`  ✅ [${label}] エンゲージメント投稿完了 (${tweetId})`);
  } catch (e: any) {
    markFailed(queueItem.id, e.message);
    throw e;
  }
}

async function postMyFansSlot(label: string) {
  const validation = validatePost(true);
  if (!validation.allowed) {
    console.log(`  [${label}] 安全制限: ${validation.errors.join(', ')}`);
    return;
  }

  const templates = [
    '💕 MyFansで限定コンテンツ配信中！\n無料で覗けるから気軽にチェックしてね✨\n#MyFans #限定コンテンツ',
    '🔥 MyFansならではの特別コンテンツ！\nフォローだけでも見れるものがたくさん📱\n#MyFans',
    '✨ 今日も新しいコンテンツをMyFansに投稿しました！\nプロフのリンクからどうぞ💖\n#MyFans #新着',
  ];
  const text = templates[Math.floor(Math.random() * templates.length)];

  const filterResult = filterContent(text, getRunConfig().safetyStrictness);
  if (!filterResult.safe) {
    console.warn(`  🚫 [${label}] MyFansフィルター: ${filterResult.reason}`);
    return;
  }

  const queueItem = enqueuePost({ type: 'myfans', text, filterResult });

  if (isDryRun()) {
    console.log(`  🧪 [${label}] DRY_RUN: MyFans投稿スキップ`);
    markPosted(queueItem.id, 'dry_run');
    return;
  }
  if (!isAutoPostEnabled()) {
    console.log(`  ⏸ [${label}] AUTO_POST無効: キューに追加済み (id=${queueItem.id})`);
    return;
  }

  const tweetId = await postTweet(text, []);
  markPosted(queueItem.id, tweetId);
  recordPost({ tweetId, replyId: '', text, type: 'myfans' });
  recordPostEvent(true);
  console.log(`  ✅ [${label}] MyFans投稿完了 (${tweetId})`);
}

async function postEroticStorySlot(label: string) {
  const validation = validatePost(false);
  if (!validation.allowed) {
    console.log(`  [${label}] 安全制限: ${validation.errors.join(', ')}`);
    return;
  }

  const { text, imagePrompt } = generateEroticStoryTweet();

  const textFilter = filterContent(text, getRunConfig().safetyStrictness);
  if (!textFilter.safe) {
    console.warn(`  🚫 [${label}] テキストフィルター: ${textFilter.reason}`);
    return;
  }
  const promptFilter = filterImagePrompt(imagePrompt);
  if (!promptFilter.safe) {
    console.warn(`  🚫 [${label}] 画像プロンプトフィルター: ${promptFilter.reason}`);
    return;
  }

  const queueItem = enqueuePost({ type: 'erotic-story', text, imagePrompt, filterResult: textFilter });

  const safetyScoreEs = Math.max(0, 100 - (textFilter.blockedWords?.length ?? 0) * 20);

  if (isDryRun()) {
    console.log(`  🧪 [${label}] DRY_RUN: 猥談投稿スキップ (text先頭: ${text.slice(0, 40)})`);
    markPosted(queueItem.id, 'dry_run');
    recordAnalytics({
      postId: queueItem.id, postedAt: new Date().toISOString(), provider: 'twitter',
      productId: '', productTitle: '(猥談ストーリー)', category: 'erotic-story',
      templateType: 'erotic-story', templateCategory: 'erotic-story',
      text, url: '', shortUrl: '', imageUsed: false, safetyScore: safetyScoreEs,
      result: 'dry_run', clicks: 0, impressions: 0, likes: 0, reposts: 0, replies: 0, metricsUpdatedAt: null,
    });
    return;
  }
  if (!isAutoPostEnabled()) {
    console.log(`  ⏸ [${label}] AUTO_POST無効: キューに追加済み (id=${queueItem.id})`);
    recordAnalytics({
      postId: queueItem.id, postedAt: new Date().toISOString(), provider: 'twitter',
      productId: '', productTitle: '(猥談ストーリー)', category: 'erotic-story',
      templateType: 'erotic-story', templateCategory: 'erotic-story',
      text, url: '', shortUrl: '', imageUsed: false, safetyScore: safetyScoreEs,
      result: 'queued', clicks: 0, impressions: 0, likes: 0, reposts: 0, replies: 0, metricsUpdatedAt: null,
    });
    return;
  }

  console.log(`  🖼️ [${label}] 猥談画像プロンプト: ${imagePrompt.slice(0, 80)}...`);
  let mediaIds: string[] = [];
  let imageUsed = false;
  try {
    const imageUrl = await generateImage(imagePrompt, { model: 'pony-v6' });
    mediaIds = await uploadImages([imageUrl]);
    imageUsed = true;
    console.log(`  ✅ [${label}] 画像生成・アップロード完了`);
  } catch (e: any) {
    console.warn(`  ⚠ [${label}] 画像生成失敗、テキストのみ投稿: ${e.message}`);
  }

  try {
    const tweetId = await postTweet(text, mediaIds);
    markPosted(queueItem.id, tweetId);
    recordPost({ tweetId, replyId: '', text, type: 'engagement', imagePrompt });
    recordPostEvent(false);
    recordAnalytics({
      postId: tweetId, postedAt: new Date().toISOString(), provider: 'twitter',
      productId: '', productTitle: '(猥談ストーリー)', category: 'erotic-story',
      templateType: 'erotic-story', templateCategory: 'erotic-story',
      text, url: '', shortUrl: '', imageUsed, safetyScore: safetyScoreEs,
      result: 'posted', clicks: 0, impressions: 0, likes: 0, reposts: 0, replies: 0, metricsUpdatedAt: null,
    });
    console.log(`  ✅ [${label}] 猥談投稿完了 (${tweetId})`);
  } catch (e: any) {
    markFailed(queueItem.id, e.message);
    throw e;
  }
}

export async function triggerEmergencyPost(): Promise<void> {
  const items = await getRandomItems(1);
  if (items.length === 0) throw new Error('緊急投稿: アイテム取得失敗');
  const result = await postFanzaItem(items[0], 'emergency', '緊急回復投稿');
  if (result === null) throw new Error('緊急投稿: 安全制限により投稿不可');
}

// ─── 手動生成 → キュー追加（Discordコマンド用） ──────────────────────────────
//  type: 'engagement' | 'fanza' | 'erotic-story' | 'myfans'
//  生成してキューに積む（auto_post/dry_run には従わない＝pending固定）

export async function manualGenerateAndQueue(type: ContentSlotType): Promise<{
  queueId: string;
  text: string;
  type: string;
  affiliateUrl?: string;
  itemTitle?: string;
  imageUrl?: string;
}> {
  let text = '';
  let affiliateUrl: string | undefined;
  let itemTitle: string | undefined;
  let sourceUrl: string | undefined;
  let imageUrl: string | undefined;
  let templateType: string | undefined;
  let templateCategory: ReturnType<typeof pickFanzaTemplate>['templateCategory'] | undefined;

  if (type === 'engagement') {
    const res = generateImpressionTweet(Math.random() < 0.3);
    text = res.text;
  } else if (type === 'erotic-story') {
    const res = generateEroticStoryTweet();
    text = res.text;
  } else if (type === 'fanza') {
    const items = await getRandomItems(1);
    if (!items.length) throw new Error('FANZAアイテム取得失敗');
    const item = items[0];
    const tmpl = pickFanzaTemplate(item, 'videoa');
    text = tmpl.text;
    templateType = tmpl.templateType;
    templateCategory = tmpl.templateCategory;
    affiliateUrl = item.affiliateURL;
    itemTitle = item.title;
    sourceUrl = item.content_id ?? item.id;
    imageUrl = getSampleImages(item)[0] ?? undefined;
  } else {
    // myfans
    const mfTemplates = [
      '💕 MyFansで限定コンテンツ配信中！\n無料で覗けるから気軽にチェックしてね✨\n#MyFans #限定コンテンツ',
      '🔥 MyFansならではの特別コンテンツ！\nフォローだけでも見れるものがたくさん📱\n#MyFans',
    ];
    text = mfTemplates[Math.floor(Math.random() * mfTemplates.length)];
  }

  const filterResult = filterContent(text, getRunConfig().safetyStrictness);
  const queueItem = enqueuePost({
    type,
    text,
    itemTitle,
    affiliateUrl,
    imageUrl,
    sourceUrl,
    templateType,
    templateCategory,
    safetyScore: Math.max(0, 100 - (filterResult.blockedWords?.length ?? 0) * 20),
    filterResult,
  });

  return { queueId: queueItem.id, text, type, affiliateUrl, itemTitle, imageUrl };
}

// ─── スマート投稿生成（インサイト+トレンド+画像連携）────────────────────────
//  分析記憶・外部トレンドパターン・自分の高インプ投稿を全部ContextにしてAI生成
//  withImage=true の場合:
//    fanza  → FANZAサンプル画像を添付
//    engagement/erotic-story → FAL.ai で画像生成

export async function manualGenerateSmartPost(
  type: ContentSlotType,
  withImage = false,
): Promise<{
  queueId: string;
  text: string;
  type: string;
  affiliateUrl?: string;
  itemTitle?: string;
  imageUrl?: string;
}> {
  const anthropicClient = new Anthropic({
    baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    apiKey:  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  });

  // ── Context 収集 ──────────────────────────────────────────────────────────

  const insightCtx = buildInsightContext(8);

  const topExternal = getExternalTopPatterns(5)
    .map((p, i) => `外部TOP${i + 1}(スコア${p.score}): ${p.text.slice(0, 80)}`)
    .join('\n');

  const topOwn = getAnalytics(14)
    .filter(r => r.result === 'posted' && r.impressions > 0)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 3)
    .map((r, i) => `自分TOP${i + 1}(インプ${r.impressions}): ${r.text.slice(0, 80)}`)
    .join('\n');

  let fanzaItem: any = null;
  let affiliateUrl: string | undefined;
  let itemTitle: string | undefined;

  if (type === 'fanza') {
    const items = await getHighRatedItems(1).catch(() => []);
    if (items.length > 0) {
      fanzaItem = items[0];
      affiliateUrl = fanzaItem.affiliateURL;
      itemTitle = fanzaItem.title;
    } else {
      const fallback = await getRandomItems(1).catch(() => []);
      if (fallback.length > 0) {
        fanzaItem = fallback[0];
        affiliateUrl = fanzaItem.affiliateURL;
        itemTitle = fanzaItem.title;
      }
    }
  }

  // ── AI 生成プロンプト ────────────────────────────────────────────────────

  const systemPrompt = `あなたはX（旧Twitter）の投稿最適化の専門家です。
以下のインサイト・トレンドパターン・自アカウントの実績を参考に、バズる投稿テキストを1本生成してください。

【蓄積インサイト】
${insightCtx || '（まだデータなし）'}

【外部トレンドTOP5】
${topExternal || '（データなし）'}

【自アカウント高インプ投稿TOP3】
${topOwn || '（データなし）'}

【生成ルール】
- 140文字以内（日本語）
- 感嘆符・絵文字を効果的に使用
- 「→❤️」「→🔁」等のCTA必須
- アフィリエイトリンクは「[URL]」プレースホルダーで
- テキストのみ返す（説明文不要）`;

  const userMsg = type === 'fanza' && fanzaItem
    ? `作品タイプ: FANZA\n作品名: ${fanzaItem.title?.slice(0, 50)}\n女優: ${fanzaItem.actress ?? '不明'}\nレビュー: ${fanzaItem.review?.average ?? '-'}点/${fanzaItem.review?.count ?? 0}件\nアフィリエイトURL: ${affiliateUrl ?? '(なし)'}\nこの作品の紹介投稿を生成してください。`
    : `投稿タイプ: ${type}\nインサイトとトレンドパターンを参考に最適化した投稿を生成してください。`;

  let text = '';
  try {
    const resp = await anthropicClient.messages.create({
      model: 'claude-haiku-4-5',
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
      max_tokens: 300,
    });
    text = resp.content.filter(b => b.type === 'text').map(b => (b as any).text).join('').trim();
    if (!text) throw new Error('AIが空のレスポンスを返した');
  } catch (e: any) {
    console.warn(`  ⚠ [SmartPost] AI生成失敗 → フォールバック: ${e.message}`);
    const fallback = generateImpressionTweet(false);
    text = fallback.text;
  }

  // ── 画像取得/生成 ────────────────────────────────────────────────────────

  let imageUrl: string | undefined;
  if (withImage) {
    try {
      if (type === 'fanza' && fanzaItem) {
        const sampleImages = getSampleImages(fanzaItem);
        imageUrl = sampleImages[0] ?? undefined;
      } else {
        const prompt = buildImagePrompt(text);
        const filtered = filterImagePrompt(prompt);
        if (filtered.safe) {
          imageUrl = await generateImage(prompt, { engine: 'auto' });
        }
      }
    } catch (e: any) {
      console.warn(`  ⚠ [SmartPost] 画像取得/生成失敗: ${e.message}`);
    }
  }

  // ── キュー登録 ────────────────────────────────────────────────────────────

  const filterResult = filterContent(text, getRunConfig().safetyStrictness);
  const queueItem = enqueuePost({
    type,
    text,
    itemTitle,
    affiliateUrl,
    imageUrl,
    sourceUrl: fanzaItem?.content_id ?? fanzaItem?.id,
    filterResult,
  });

  return { queueId: queueItem.id, text, type, affiliateUrl, itemTitle, imageUrl };
}

async function runScheduledSlot(label: string) {
  if (isPosting) {
    console.log(`  [${label}] 前の投稿処理が進行中 → スキップ`);
    return;
  }

  const safety = getSafetyStatus();
  if (safety.automationLevel === 'MANUAL_ONLY') {
    console.log(`  [${label}] 手動モード中 → 自動投稿スキップ`);
    return;
  }

  isPosting = true;
  _postingStartedAt = Date.now();
  try {
    const slotType = pickSlotType();
    const jst = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    console.log(`\n[${jst}] ${label} スロット開始 (type: ${slotType})`);

    switch (slotType) {
      case 'engagement':
        await postEngagementSlot(label);
        break;
      case 'erotic-story':
        await postEroticStorySlot(label);
        break;
      case 'fanza': {
        const items = isHighRevenueHour()
          ? await getRevenueOptimizedItems(1).catch(() => getRandomItems(1))
          : await getRandomItems(1);
        if (items.length > 0) await postFanzaItem(items[0], 'random', label);
        break;
      }
      case 'myfans':
        await postMyFansSlot(label);
        break;
    }
  } catch (e: any) {
    console.error(`  ❌ [${label}] エラー: ${e.message}`);
  } finally {
    isPosting = false;
    _postingStartedAt = null;
  }
}

async function monitoringLoop() {
  const jst = () => new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  while (true) {
    const intervalMs = getMonitorIntervalMs();
    try {
      if (!isPosting) {
        console.log(`\n[${jst()}] 📡 外部パターン監視サイクル開始`);
        const newPatterns = await refreshExternalPatterns();
        await evaluateAndAdapt(newPatterns ?? 0);
      }
    } catch (e: any) {
      console.error(`  ❌ 監視サイクルエラー: ${e.message}`);
    }
    await sleep(intervalMs);
  }
}

export function startScheduler() {
  loadSafetyState();

  loadAnalytics().catch((e: any) =>
    console.warn('  ⚠ アナリティクス読み込み失敗:', e.message),
  );

  loadInsightMemory().catch((e: any) =>
    console.warn('  ⚠ インサイトメモリ読み込み失敗:', e.message),
  );

  loadWeeklyReviews().catch((e: any) =>
    console.warn('  ⚠ 週次レビュー読み込み失敗:', e.message),
  );

  loadStrategyConfig().catch((e: any) =>
    console.warn('  ⚠ 戦略設定読み込み失敗:', e.message),
  );

  if (isSheetsConfigured()) {
    console.log('  📊 [Sheets] Google Sheets 連携: 有効');
    sleep(30 * 1000).then(() =>
      initSheetHeaders().catch((e: any) => console.warn('  ⚠ [Sheets] ヘッダー初期化失敗:', e.message)),
    );
  }

  injectSchedulerHooks({ getIsPosting, getPostingStartedAt, forceResetIsPosting, triggerEmergencyPost });
  sleep(3 * 60 * 1000).then(() => startWatchdog());

  async function startMonitoringLoop() {
    await sleep(5 * 60 * 1000);
    while (true) {
      try { await monitoringLoop(); } catch (e: any) {
        console.error(`  ❌ 監視ループ異常終了: ${e.message} — 5分後再起動`);
        await sleep(5 * 60 * 1000);
      }
    }
  }
  startMonitoringLoop();

  sleep(10 * 60 * 1000).then(() =>
    discoverCampaignIds({ maxProbe: 200 }).catch((e: any) =>
      console.warn('  ⚠ キャンペーンID探索失敗:', e.message),
    ),
  );

  cron.schedule('0 3 * * 0', async () => {
    await discoverCampaignIds({ maxProbe: 300 }).catch((e: any) =>
      console.warn('  ⚠ キャンペーンID週次探索失敗:', e.message),
    );
    autoCompleteTask('weekly-campaign-scan', 'weekly').catch(() => {});
  }, { timezone: 'Asia/Tokyo' });

  // 日曜 05:00 JST — 週次AIレビュー（投稿実績分析・改善案生成）
  cron.schedule('0 5 * * 0', async () => {
    console.log('\n  📊 [週次レビュー] AI分析開始...');
    try {
      const result = await runWeeklyReview();
      console.log(`  ✅ [週次レビュー] 完了: ${result.id} / ${result.stats.total}件分析 / 改善案${result.review.improvements.length}件`);
    } catch (e: any) {
      console.error(`  ❌ [週次レビュー] エラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 10:30 JST — エンゲージメント投稿①
  cron.schedule('30 10 * * *', () => runScheduledSlot('10:30 スロット①'), { timezone: 'Asia/Tokyo' });

  // 17:00 JST — FANZA/MyFans/エンゲージメント投稿②
  cron.schedule('0 17 * * *', () => runScheduledSlot('17:00 スロット②'), { timezone: 'Asia/Tokyo' });

  // 20:00 JST — プライムタイム投稿③
  cron.schedule('0 20 * * *', () => runScheduledSlot('20:00 スロット③'), { timezone: 'Asia/Tokyo' });

  // 02:00 JST — 深夜インプ投稿④ [Grok分析: 深夜2-4時 インプ+50%]
  // 感情爆発型・日常ｗｗ型テンプレートを優先。🔞タグなし、凍結リスク低
  cron.schedule('0 2 * * *', () => runScheduledSlot('02:00 深夜スロット④'), { timezone: 'Asia/Tokyo' });

  // 毎時05分 — クリック実績で強い時間帯だけ収益候補を自動キュー投入
  cron.schedule('5 * * * *', async () => {
    if (!isAutoRevenueQueueEnabled()) return;
    if (!isHighRevenueHour()) return;
    try {
      await autoFillRevenueQueue(`収益候補自動キュー ${getRecommendedRevenueHours(30).join('/')}時`);
    } catch (e: any) {
      console.warn(`  ⚠ [収益候補自動キュー] 失敗: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 5分ごと — 承認済みキューを1件ずつ投稿
  cron.schedule('*/5 * * * *', async () => {
    try {
      const results = await processApprovedQueue(1);
      const posted = results.find((r) => r.ok && !r.skipped);
      if (posted?.tweetId) console.log(`  ✅ [Queue] 承認済み投稿完了: ${posted.tweetId}`);
      const failed = results.find((r) => !r.ok);
      if (failed?.error) console.warn(`  ⚠ [Queue] 承認済み投稿失敗: ${failed.error}`);
    } catch (e: any) {
      console.warn(`  ⚠ [Queue] 承認済み投稿処理エラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 09:00 JST — 日次フォロワースナップショット + Safety Engine更新
  cron.schedule('0 9 * * *', async () => {
    try {
      const prev = getLatestSnapshot();
      const info = await getAccountInfo();
      if (!info) return;
      recordAccountSnapshot({ followersCount: info.followersCount, followingCount: info.followingCount, tweetCount: info.tweetCount, note: '日次自動記録' });
      updateFollowerCount(info.followersCount);

      if (prev) {
        const delta = info.followersCount - prev.followersCount;
        console.log(`  📊 [日次スナップ] フォロワー: ${info.followersCount}人 (${delta >= 0 ? '+' : ''}${delta}人)`);
      }

      if (isSheetsConfigured()) {
        const snaps = getDailyImpressionSnapshots(7);
        const avgImp = snaps.length > 0 ? Math.round(snaps.reduce((a, b) => a + b.avgImpressions, 0) / snaps.length) : 0;
        const nowJst = new Date(Date.now() + 9 * 3600000);
        const todayStart = new Date(Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate()) - 9 * 3600000);
        const todayPosts = getPostsAfter(todayStart).length;
        await appendAccountMetrics({
          recordedAt: new Date().toISOString(),
          followersCount: info.followersCount,
          followingCount: info.followingCount,
          tweetCount: info.tweetCount,
          avgImpressions: avgImp,
          totalPostsToday: todayPosts,
          note: '日次自動記録',
        }).catch((e: any) => console.warn('  ⚠ [Sheets] AccountMetrics書き込み失敗:', e.message));
      }
    } catch (e: any) {
      console.warn('  ⚠ 日次スナップ失敗:', e.message);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 06:00 JST — Rebrandlyクリック数自動同期
  cron.schedule('0 6 * * *', async () => {
    try {
      const candidates = getQueue(['pending', 'approved'])
        .filter(item => item.affiliateUrl)
        .map(item => ({
          affiliateUrl: item.affiliateUrl,
          itemId: item.sourceUrl ?? item.id,
          title: item.itemTitle ?? item.type,
        }));
      if (candidates.length > 0 && process.env.REBRANDLY_API_KEY) {
        const created = await autoCreateRebrandlyLinks(candidates);
        console.log(`  🔗 [Rebrandly] キュー内リンク自動作成: 新規${created.created}件 / 既存${created.reused}件`);
      }
      const result = await syncRebrandlyClicks();
      if (result) console.log(`  🔗 [Rebrandly] 同期完了: ${result.synced}件 / 総クリック ${result.totalClicks}`);
    } catch (e: any) {
      console.warn('  ⚠ Rebrandly同期失敗:', e.message);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 08:00 JST — タイムライン自動同期
  cron.schedule('0 8 * * *', async () => {
    try {
      const tweets = await getOwnRecentTweets(50);
      let newCount = 0, updatedCount = 0;
      for (const t of tweets) {
        const { isNew } = recordPostManual({
          tweetId: t.id, text: t.text,
          postedAt: (t as any).created_at ?? new Date().toISOString(),
          metrics: (t.public_metrics as any) ?? null,
        });
        if (isNew) newCount++; else updatedCount++;
      }
      console.log(`  ✅ [TL同期] 新規: ${newCount}件 / 更新: ${updatedCount}件`);
    } catch (e: any) {
      console.warn(`  ⚠ [TL同期] 失敗: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 23:00 JST — シャドウバン回復チェック
  cron.schedule('0 23 * * *', async () => {
    try {
      await checkShadowbanRecovery();
      autoCompleteTask('daily-shadowban-check', 'daily').catch(() => {});
    } catch (e: any) {
      console.error(`  ❌ 回復チェックエラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 23:10 JST — 投稿指標更新
  cron.schedule('10 23 * * *', async () => {
    try {
      await refreshRecentMetrics();
      console.log('  ✅ [指標更新] 完了');
    } catch (e: any) {
      console.error(`  ❌ [指標更新] エラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 03:00 JST — 日次戦略評価
  cron.schedule('0 3 * * *', async () => {
    try {
      await runDailyEvaluation();
      if (isSheetsConfigured()) {
        const strategy = getStrategySummary();
        if ((strategy.hypotheses ?? []).length > 0) {
          await upsertHypotheses(
            strategy.hypotheses.map((h: any) => ({
              id: h.id, question: h.question, status: h.status,
              finding: h.finding ?? '', adjustment: h.adjustment ?? '',
              testedAt: h.testedAt ?? new Date().toISOString(),
            })),
          ).catch((e: any) => console.warn('  ⚠ [Sheets] Hypotheses書き込み失敗:', e.message));
        }
      }
    } catch (e: any) {
      console.error(`  ❌ 日次評価エラー: ${e.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 月曜 08:00 JST — 週次レポート
  cron.schedule('0 8 * * 1', async () => {
    try {
      const info = await getAccountInfo();
      if (info) {
        recordAccountSnapshot({ followersCount: info.followersCount, followingCount: info.followingCount, tweetCount: info.tweetCount, note: '週次自動記録' });
        updateFollowerCount(info.followersCount);
      }
    } catch (e: any) {
      console.warn('  ⚠ 週次スナップ失敗:', e.message);
    }

    try {
      const fb = await buildManualPostFeedback(7);
      if (fb) {
        recordManualFeedback(fb);
        console.log(`  ✅ 手動投稿FB完了: ${fb.tweetCount}件分析`);
      }
    } catch (e: any) {
      console.warn('  ⚠ 手動投稿FB失敗:', e.message);
    }

    autoCompleteTask('weekly-perf-report', 'weekly').catch(() => {});
  }, { timezone: 'Asia/Tokyo' });

  const safety = getSafetyStatus();
  console.log('');
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║  MyFans×FANZA 二刀流Bot                      ║');
  console.log('╠═══════════════════════════════════════════════╣');
  console.log(`║  🛡️ 安全レベル: ${safety.automationLevel.padEnd(30)}║`);
  console.log(`║  📊 リスクスコア: ${String(safety.riskScore).padEnd(28)}║`);
  console.log(`║  👥 フォロワー: ${String(safety.followerCount).padEnd(29)}║`);
  console.log('║  📅 投稿スロット:                              ║');
  console.log('║    10:30 / 17:00 / 20:00 JST                  ║');
  console.log('║  📈 比率: 40%エンゲージ/25%猥談画像/25%FANZA/10%MyFans ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log('');
}
