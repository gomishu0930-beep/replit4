/**
 * discord-bot.ts — Discord ボット統合 + Claude 常駐エージェント
 *
 * 機能:
 *  - 投稿キュー追加時に通知（✅承認 / ❌却下 ボタン付き）
 *  - スラッシュコマンド: /status /queue /approve /reject /dryrun /pause /resume
 *  - @メンションで Claude エージェントが応答（ツール呼び出し対応）
 */

import {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  type Interaction, type ChatInputCommandInteraction,
  type ButtonInteraction, Events,
} from 'discord.js';
import Anthropic from '@anthropic-ai/sdk';
import {
  getQueue, getQueueStats, approveQueueItem, rejectQueueItem, type QueueItem,
} from './post-queue.js';
import { getRunConfig, updateRunConfig } from './run-config.js';
import { getMyfansItems } from './myfans-store.js';
import { manualGenerateAndQueue, manualGenerateSmartPost } from './scheduler.js';
import { fetchUserTimelineByUsername } from './twitter.js';
import { getPerformanceByCategory, getAnalyticsStats, getAnalytics } from './post-analytics.js';
import { getExternalTopPatterns, getTopPatterns } from './storage.js';
import { refreshExternalPatterns } from './analytics.js';
import {
  saveInsight, getInsights, getInsightSummary, deleteInsight, buildInsightContext,
  type InsightRecord,
} from './insight-memory.js';

const TOKEN      = process.env.DISCORD_BOT_TOKEN ?? '';
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID ?? '';
const GUILD_ID   = process.env.DISCORD_GUILD_ID ?? '';

let client: Client | null = null;

const anthropic = new Anthropic({
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  apiKey:  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
});

// ─── 会話履歴（チャンネルごと、最大20往復） ───────────────────────────────────

type HistoryMsg = { role: 'user' | 'assistant'; content: string };
const conversationHistory = new Map<string, HistoryMsg[]>();
const MAX_HISTORY = 40; // user+assistant で20往復

// ─── Claude が使えるツール定義 ────────────────────────────────────────────────

const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_status',
    description: '現在のボット状態（キュー統計・設定・モード）を取得する',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_queue',
    description: '投稿キューの一覧を取得する。statusで絞り込み可能。',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'approved', 'posted', 'rejected', 'failed', 'dry_run'],
          description: 'フィルタするステータス（省略時は全件）',
        },
      },
    },
  },
  {
    name: 'approve_item',
    description: 'キューアイテムを承認して投稿スケジューラーに渡す',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'queue_id（先頭8文字でもOK）' },
      },
      required: ['id'],
    },
  },
  {
    name: 'reject_item',
    description: 'キューアイテムを却下する',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'queue_id（先頭8文字でもOK）' },
      },
      required: ['id'],
    },
  },
  {
    name: 'set_dryrun',
    description: 'DRY_RUNモードをONまたはOFFに設定する',
    input_schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'trueでDRY_RUN ON、falseで本番モード' },
      },
      required: ['enabled'],
    },
  },
  {
    name: 'set_auto_post',
    description: '自動投稿をONまたはOFFにする',
    input_schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'trueでON、falseでOFF（緊急停止）' },
      },
      required: ['enabled'],
    },
  },
  {
    name: 'get_myfans_items',
    description: 'MyFans管理アイテムの一覧を取得する',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['draft', 'reviewed', 'approved', 'rejected', 'posted'],
          description: 'フィルタするステータス（省略時は全件）',
        },
      },
    },
  },
  {
    name: 'analyze_user_timeline',
    description: 'ユーザー名でXタイムラインを直接取得して投稿パフォーマンスを分析する（手動投稿含む全投稿対象）',
    input_schema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Xのユーザー名（@なし。例: fanza_poll_lab）' },
        count: { type: 'number', description: '取得件数（デフォルト30、最大100）' },
        save_insight: { type: 'boolean', description: 'trueでトップパターンをインサイトに自動保存' },
      },
      required: ['username'],
    },
  },
  {
    name: 'get_own_top_posts',
    description: '自分の高パフォーマンス投稿TOP Nを取得する（インプ・いいね順）',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '対象期間（日数、デフォルト14）' },
        n: { type: 'number', description: '取得件数（デフォルト5）' },
      },
    },
  },
  {
    name: 'get_trending_posts',
    description: '外部トレンド投稿TOP Nを取得する。refresh=trueで最新データに更新してから返す',
    input_schema: {
      type: 'object',
      properties: {
        n: { type: 'number', description: '取得件数（デフォルト10）' },
        refresh: { type: 'boolean', description: 'trueで最新データ取得（数十秒かかる）' },
      },
    },
  },
  {
    name: 'save_insight_memory',
    description: '分析インサイトを記憶ストアに永続保存する。投稿生成時に自動参照される',
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['own-post', 'trending', 'competitor', 'media', 'strategy'],
          description: 'インサイトカテゴリ',
        },
        title: { type: 'string', description: '短いタイトル（20文字程度）' },
        content: { type: 'string', description: '具体的な内容・学び（200文字程度）' },
        tags: { type: 'array', items: { type: 'string' }, description: 'タグ（例: ["感情爆発","CTAパターン"]）' },
        score: { type: 'number', description: '重要度 0-100（デフォルト50）' },
        source: { type: 'string', description: '参照元（アカウント名等）' },
      },
      required: ['category', 'title', 'content'],
    },
  },
  {
    name: 'get_insight_memory',
    description: '記憶ストアのインサイトを取得する',
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['own-post', 'trending', 'competitor', 'media', 'strategy'],
          description: '絞り込むカテゴリ（省略時は全件）',
        },
        limit: { type: 'number', description: '取得件数（デフォルト10）' },
      },
    },
  },
  {
    name: 'generate_smart_post',
    description: '蓄積インサイト・トレンドパターン・自分の高インプ投稿を参考に最適化した投稿を生成する',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['engagement', 'fanza', 'erotic-story', 'myfans'],
          description: 'コンテンツタイプ',
        },
        with_image: { type: 'boolean', description: 'trueで画像付き（FANZA=サンプル画像/他=AI生成）' },
      },
      required: ['type'],
    },
  },
  {
    name: 'generate_and_queue',
    description: '指定タイプのコンテンツを生成してキューに追加する（手動投稿用）',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['engagement', 'fanza', 'erotic-story', 'myfans'],
          description: 'コンテンツタイプ',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'analyze_performance',
    description: '過去N日間の投稿パフォーマンスをカテゴリ別に分析する',
    input_schema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: '分析期間（日数）。省略時は7日',
        },
      },
    },
  },
  {
    name: 'apply_insights',
    description: '投稿分析結果をもとにカテゴリ比率（categoryWeights）を最適化して反映する',
    input_schema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: '分析期間（日数）。省略時は7日',
        },
      },
    },
  },
];

// ─── ツール実行 ───────────────────────────────────────────────────────────────

async function executeTool(name: string, input: Record<string, any>): Promise<string> {
  try {
    switch (name) {

      case 'get_status': {
        const cfg = getRunConfig();
        const stats = getQueueStats();
        return JSON.stringify({
          mode: cfg.dryRun ? 'DRY_RUN' : '本番',
          autoPost: cfg.autoPostEnabled,
          discordNotify: cfg.discordNotifyEnabled,
          queue: stats,
          limits: {
            maxPerDay: cfg.maxPostsPerDay,
            maxPerHour: cfg.maxPostsPerHour,
            cooldownMinutes: cfg.cooldownMinutes,
          },
          safetyStrictness: cfg.safetyStrictness,
          categoryWeights: cfg.categoryWeights,
        }, null, 2);
      }

      case 'get_queue': {
        const statusFilter = input.status ? [input.status] : undefined;
        const items = getQueue(statusFilter as any).slice(0, 10);
        return JSON.stringify(items.map(i => ({
          id: i.id.slice(0, 8),
          fullId: i.id,
          type: i.type,
          status: i.status,
          title: i.itemTitle,
          textPreview: i.text.slice(0, 80),
          affiliateUrl: i.affiliateUrl,
          createdAt: i.createdAt,
        })), null, 2);
      }

      case 'approve_item': {
        const all = getQueue();
        const item = all.find(q => q.id === input.id || q.id.startsWith(input.id));
        if (!item) return `エラー: ID "${input.id}" が見つかりません`;
        const result = approveQueueItem(item.id);
        if (!result) return `エラー: 承認失敗（status=${item.status}）`;
        return `承認成功: id=${item.id.slice(0, 8)} type=${item.type}`;
      }

      case 'reject_item': {
        const all = getQueue();
        const item = all.find(q => q.id === input.id || q.id.startsWith(input.id));
        if (!item) return `エラー: ID "${input.id}" が見つかりません`;
        rejectQueueItem(item.id);
        return `却下完了: id=${item.id.slice(0, 8)}`;
      }

      case 'set_dryrun': {
        updateRunConfig({ dryRun: input.enabled });
        return input.enabled ? 'DRY_RUN を ON にしました。実際には投稿されません。' : 'DRY_RUN を OFF にしました。本番モードです。';
      }

      case 'set_auto_post': {
        updateRunConfig({ autoPostEnabled: input.enabled });
        return input.enabled ? '自動投稿を ON にしました。' : '自動投稿を OFF にしました（緊急停止）。';
      }

      case 'get_myfans_items': {
        const items = getMyfansItems(input.status).slice(0, 10);
        return JSON.stringify(items.map(i => ({
          id: i.id.slice(0, 8),
          creator: i.creator_name,
          status: i.status,
          hasCaption: !!i.generated_caption,
          captionPreview: i.generated_caption?.slice(0, 60),
          queue_id: i.queue_id?.slice(0, 8),
          updatedAt: i.updated_at,
        })), null, 2);
      }

      case 'analyze_user_timeline': {
        const uname = String(input.username).replace(/^@/, '');
        const cnt = Math.min(Number(input.count ?? 30), 100);
        const doSave = Boolean(input.save_insight);

        let tweets: Awaited<ReturnType<typeof fetchUserTimelineByUsername>>;
        try {
          tweets = await fetchUserTimelineByUsername(uname, cnt);
        } catch (e: any) {
          return `❌ @${uname} のタイムライン取得失敗: ${e.message}`;
        }

        if (tweets.length === 0) return `@${uname} に投稿が見つかりません。`;

        const sorted = [...tweets].sort((a, b) => b.impression_count - a.impression_count);
        const top5 = sorted.slice(0, 5);

        const totalImp  = tweets.reduce((s, t) => s + t.impression_count, 0);
        const totalLike = tweets.reduce((s, t) => s + t.like_count, 0);
        const totalRT   = tweets.reduce((s, t) => s + t.retweet_count, 0);
        const avgImp    = Math.round(totalImp / tweets.length);
        const avgLike   = Math.round(totalLike / tweets.length);

        const top5Summary = top5.map((t, i) =>
          `TOP${i + 1}(インプ${t.impression_count}/いいね${t.like_count}/RT${t.retweet_count}): ${t.text.slice(0, 80)}`,
        ).join('\n');

        if (doSave && top5.length > 0) {
          saveInsight(
            'own-post',
            `@${uname} TOP投稿パターン（${cnt}件分析）`,
            top5Summary,
            ['top-post', 'timeline-analysis', uname],
            72,
            `@${uname}`,
          );
        }

        return JSON.stringify({
          username: `@${uname}`,
          fetched: tweets.length,
          avgImpressions: avgImp,
          avgLikes: avgLike,
          avgRetweets: Math.round(totalRT / tweets.length),
          top5,
          insightSaved: doSave,
          summary: `@${uname} の直近${tweets.length}件: 平均インプ${avgImp} / 平均いいね${avgLike}\n${top5Summary}`,
        }, null, 2);
      }

      case 'get_own_top_posts': {
        const ownDays = Number(input.days ?? 14);
        const ownN = Number(input.n ?? 5);
        const records = getAnalytics(ownDays)
          .filter(r => r.result === 'posted')
          .sort((a, b) => b.impressions - a.impressions || b.likes - a.likes)
          .slice(0, ownN);
        if (records.length === 0) return `過去${ownDays}日間に本番投稿データがありません。DRY_RUNモードを解除してから投稿してください。`;
        return JSON.stringify(records.map((r, i) => ({
          rank: i + 1,
          category: r.category,
          impressions: r.impressions,
          likes: r.likes,
          reposts: r.reposts,
          clicks: r.clicks,
          postedAt: r.postedAt,
          textPreview: r.text.slice(0, 100),
        })), null, 2);
      }

      case 'get_trending_posts': {
        const trendN = Number(input.n ?? 10);
        const doRefresh = Boolean(input.refresh);
        if (doRefresh) {
          try {
            await refreshExternalPatterns();
          } catch (e: any) {
            console.warn('[Discord Tool] trending refresh失敗:', e.message);
          }
        }
        const patterns = getExternalTopPatterns(trendN);
        if (patterns.length === 0) return 'トレンドデータがありません。refresh=trueで取得してください。';
        return JSON.stringify(patterns.map((p, i) => ({
          rank: i + 1,
          score: p.score,
          source: p.source,
          impressions: p.impression_count,
          likes: p.like_count,
          retweets: p.retweet_count,
          textPreview: p.text.slice(0, 120),
          savedAt: p.savedAt,
        })), null, 2);
      }

      case 'save_insight_memory': {
        const ins = saveInsight(
          input.category as InsightRecord['category'],
          input.title,
          input.content,
          Array.isArray(input.tags) ? input.tags : [],
          Number(input.score ?? 50),
          input.source,
        );
        return JSON.stringify({
          success: true,
          id: ins.id,
          message: `インサイトを保存しました（id=${ins.id.slice(0, 12)}）。次回の投稿生成時から自動反映されます。`,
        });
      }

      case 'get_insight_memory': {
        const cat = input.category as InsightRecord['category'] | undefined;
        const lim = Number(input.limit ?? 10);
        const items = getInsights(cat, lim);
        const summary = getInsightSummary();
        if (items.length === 0) return `インサイトが${cat ? `カテゴリ「${cat}」に` : ''}ありません。save_insight_memoryで追加してください。`;
        return JSON.stringify({
          total: summary.total,
          byCategory: summary.byCategory,
          lastUpdatedAt: summary.lastUpdatedAt,
          items: items.map(i => ({
            id: i.id.slice(0, 12),
            category: i.category,
            title: i.title,
            content: i.content.slice(0, 100),
            tags: i.tags,
            score: i.score,
            usedCount: i.usedCount,
            savedAt: i.savedAt,
          })),
        }, null, 2);
      }

      case 'generate_smart_post': {
        const smartType = input.type as 'engagement' | 'fanza' | 'erotic-story' | 'myfans';
        const withImage = Boolean(input.with_image);
        const result = await manualGenerateSmartPost(smartType, withImage);
        return JSON.stringify({
          success: true,
          queueId: result.queueId.slice(0, 8),
          fullQueueId: result.queueId,
          type: result.type,
          itemTitle: result.itemTitle ?? '(なし)',
          imageUrl: result.imageUrl ?? null,
          textPreview: result.text.slice(0, 150),
          message: `スマート生成完了（id=${result.queueId.slice(0, 8)}）。インサイト+トレンド参考済み。/approveで投稿。`,
        }, null, 2);
      }

      case 'generate_and_queue': {
        const genType = input.type as 'engagement' | 'fanza' | 'erotic-story' | 'myfans';
        const result = await manualGenerateAndQueue(genType);
        return JSON.stringify({
          success: true,
          queueId: result.queueId.slice(0, 8),
          fullQueueId: result.queueId,
          type: result.type,
          itemTitle: result.itemTitle ?? '(なし)',
          textPreview: result.text.slice(0, 120),
          message: `キューに追加しました（id=${result.queueId.slice(0, 8)}）。/approve または「承認して投稿」ボタンで投稿できます。`,
        }, null, 2);
      }

      case 'analyze_performance': {
        const analysisDays = Number(input.days ?? 7);
        const stats = getAnalyticsStats(analysisDays);
        const byCategory = getPerformanceByCategory(analysisDays);
        return JSON.stringify({
          period: `${analysisDays}日間`,
          summary: {
            total: stats.total,
            posted: stats.posted,
            dryRun: stats.dryRun,
            failed: stats.failed,
            avgImpressions: stats.avgImpressions,
            avgLikes: stats.avgLikes,
            topCategory: stats.topCategory,
          },
          byCategory,
          recommendation: Object.entries(byCategory).length === 0
            ? 'まだ投稿データが十分ありません。投稿を増やしてからご確認ください。'
            : `最も多い投稿タイプ: ${stats.topCategory}、平均インプ: ${stats.avgImpressions}`,
        }, null, 2);
      }

      case 'apply_insights': {
        const insightDays = Number(input.days ?? 7);
        const byCategory = getPerformanceByCategory(insightDays);
        const cats = Object.entries(byCategory);
        if (cats.length === 0) {
          return '投稿データが不足しているため、比率調整をスキップしました。';
        }
        // インプ数でスコアリングし、比率を調整（合計100%に正規化）
        const scores: Record<string, number> = {
          engagement: byCategory['engagement']?.avgImpressions ?? 50,
          fanza: byCategory['fanza']?.avgImpressions ?? 30,
          'erotic-story': byCategory['erotic-story']?.avgImpressions ?? 20,
          myfans: byCategory['myfans']?.avgImpressions ?? 10,
        };
        const total = Object.values(scores).reduce((s, v) => s + v, 0) || 1;
        const base = Math.max(5, 100 / Object.keys(scores).length);
        const weights = {
          engagement: Math.round(Math.max(base, (scores['engagement'] / total) * 100)),
          eroticStory: Math.round(Math.max(base, (scores['erotic-story'] / total) * 100)),
          fanza: Math.round(Math.max(base, (scores['fanza'] / total) * 100)),
          myfans: Math.round(Math.max(base, (scores['myfans'] / total) * 100)),
        };
        // 合計100に正規化
        const wTotal = Object.values(weights).reduce((s, v) => s + v, 0);
        const scale = 100 / wTotal;
        const normalized = {
          engagement: Math.round(weights.engagement * scale),
          eroticStory: Math.round(weights.eroticStory * scale),
          fanza: Math.round(weights.fanza * scale),
          myfans: 100 - Math.round(weights.engagement * scale) - Math.round(weights.eroticStory * scale) - Math.round(weights.fanza * scale),
        };
        updateRunConfig({ categoryWeights: normalized });
        return JSON.stringify({
          success: true,
          newWeights: normalized,
          message: `カテゴリ比率を更新しました（${insightDays}日間の実績ベース）`,
          detail: `エンゲージ${normalized.engagement}% / 猥談${normalized.eroticStory}% / FANZA${normalized.fanza}% / MyFans${normalized.myfans}%`,
        }, null, 2);
      }

      default:
        return `未知のツール: ${name}`;
    }
  } catch (e: any) {
    return `ツール実行エラー: ${e.message}`;
  }
}

// ─── Claude エージェント ─────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const cfg = getRunConfig();
  const stats = getQueueStats();
  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  return `あなたは「MyFans × FANZA アフィリエイト二刀流自動化システム」の管理AIアシスタントです。
Discordでオーナーの専用窓口として常駐しています。オーナーの質問には日本語で簡潔かつ実用的に答えてください。
操作が必要な場合は必ずツールを呼び出して実際に実行してください（説明だけで終わらない）。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 現在の状態（リアルタイム）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
現在時刻: ${now} JST
モード: ${cfg.dryRun ? '🧪 DRY_RUN（テストモード・実際には投稿されない）' : '🟢 本番モード（実際に投稿される）'}
自動投稿: ${cfg.autoPostEnabled ? 'ON' : 'OFF（手動承認待ち）'}
Discord通知: ${cfg.discordNotifyEnabled ? 'ON' : 'OFF'}
キュー: 待機${stats.pending}件 / 承認済${stats.approved}件 / 投稿済${stats.posted}件 / 失敗${stats.failed}件 / DRY実行${stats.dry_run}件
日上限: ${cfg.maxPostsPerDay}件/日（${cfg.maxPostsPerHour}件/時）、クールダウン: ${cfg.cooldownMinutes}分
安全厳格度: ${cfg.safetyStrictness}
AIレビュー: ${cfg.aiReviewEnabled ? 'ON' : 'OFF'}
コンテンツ比率: エンゲージ${cfg.categoryWeights.engagement}% / 猥談${cfg.categoryWeights.eroticStory}% / FANZA${cfg.categoryWeights.fanza}% / MyFans${cfg.categoryWeights.myfans}%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ ビジネス目標（KPI）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
目標: M5（開始5ヶ月目）に黒字化
  - フォロワー: 700人（現在172人）
  - 月収: ¥26,000超（FANZA + MyFans アフィリエイト収入）
  - 月額コスト: ¥25,799
    └ Replit（サーバー）¥2,000 + ChatGPT ¥3,000 + fal.ai（画像生成）¥2,000
      + その他APIコスト ¥18,799 程度

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ アカウント戦略（二刀流）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【メインアカウント】@fanza_poll_lab
  - 役割: ブランド・エンゲージ専用
  - 運用: 手動投稿のみ（APIは使わない）
  - コンテンツ: アンケート・トレンド便乗・エロ話・人格キャラ確立

【サブアカウント】@ero_senpai1
  - 役割: マネタイズ（FANZA + MyFans アフィリエイト）
  - 運用: API接続済み・ボットが自動生成してキューに積む
  - 現在の安全レベル: MANUAL_ONLY（オーナーがDiscordで承認してから投稿）
  - 段階的自動化ロードマップ:
    * MANUAL_ONLY → フォロワー300人でSEMI_AUTO → 1000人でFULL_AUTO

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 安全システム（safety-engine.ts）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
自動化レベル:
  - MANUAL_ONLY: 全投稿をDiscordで手動承認（現在のモード）
  - SEMI_AUTO: 低リスク投稿は自動、高リスクは承認待ち（フォロワー300人〜）
  - FULL_AUTO: 全自動（フォロワー1000人〜）

リスクスコア（0〜100、低いほど安全）:
  - アフィリエイト比率が高いと上昇
  - 連続アフィリエイト投稿で上昇
  - フォロワー数が少ないと上昇
  - 現在スコア: loadSafetyStateで確認可能

安全設定:
  - アフィリエイト比率上限: 30%
  - 連続アフィリエイト上限: 1回（必ず間に非アフィリエイト挟む）
  - 日フォロー上限: 50人
  - 週別投稿上限: 1週目3件 → 2週目3件 → ... → 9週目〜12件

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ コンテンツ種別（4タイプ）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. engagement（エンゲージ・40%）
   - いいね・RT・リプを稼ぐ共感系・アンケート・トレンド便乗ツイート
   - 例: 「朝5時まで〇〇してた人RT」「好みの体型選んで」など
   - Grok（X API）でバズワードをリサーチして生成

2. erotic-story（猥談・25%）
   - 短編エロ小説・体験談風テキスト（画像なし）
   - GPT-4oで生成、フィルタリング後キューへ

3. fanza（FANZAアフィリエイト・25%）
   - FANZA APIで商品取得（AV・同人・電子書籍）
   - DMM_AFFILIATE_ID / DMM_API_ID を使用
   - サンプル画像 + アフィリエイトURL + GPT生成キャプション
   - Rebrandlyで短縮URL作成

4. myfans（MyFansアフィリエイト・10%）
   - MyFansクリエイターへのアフィリエイト
   - ブラウザ自動化でデータ収集 → /api/myfans/ingest でDB登録
   - ダッシュボードでキャプション生成・承認・キュー送信

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 投稿フロー（キューシステム）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【スケジューラー起動タイミング】
  - 投稿スロット: 10:30 / 17:00 / 20:00 JST（cron）
  - その他: 分析・レビュー・会議・監視など多数のcronジョブ

【投稿フロー】
  スケジューラー
    → コンテンツ生成（AI + FANZA/MyFans API）
    → コンテンツフィルタリング（content-filter.ts）
    → enqueuePost()でキューに積む（status: pending）
    → Discordに通知（ボタン付きembed）
    → オーナーが「✅ 承認」ボタン or /approve コマンド
    → status: approved
    → 次のスケジューラーサイクルで実際にTwitter投稿
    → status: posted（本番）or dry_run（DRY_RUNモード）

【キューステータス一覧】
  pending   → 承認待ち（Discordで操作）
  approved  → 承認済み・投稿待ち
  posted    → 投稿完了
  dry_run   → DRY_RUNモードで「仮実行」済み
  rejected  → 却下済み
  failed    → 投稿失敗（エラーあり）
  ※ pendingは24時間で自動却下

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ MyFans管理システム
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
アイテムステータス:
  draft     → 取得済み・キャプション未生成
  reviewed  → AI生成済み・人間確認待ち
  approved  → 承認済み・投稿キュー送信可能
  rejected  → 却下
  posted    → 投稿完了

操作フロー:
  1. /api/myfans/ingest でクリエイター情報をDBに登録（MYFANS_INGEST_SECRET認証）
  2. /api/myfans/:id/generate でGPT-4oがキャプション生成
  3. ダッシュボードまたはDiscord（@メンション）で確認・承認
  4. /api/myfans/:id/queue でキューに送信
  5. Discordに通知 → 承認 → 投稿

ダッシュボードURL（開発）: /bot-dashboard にアクセス
ダッシュボードで操作できること:
  - MyFansアイテムの一覧・確認・承認・却下
  - キャプション再生成
  - キューへの送信
  - FetchJob作成（ブラウザ自動化への指示書生成）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 外部サービス連携
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Twitter/X API:
  - @ero_senpai1 のTwitter_ACCESS_TOKEN / SECRET でOAuth 1.0a認証
  - 投稿・リプライ・いいね・フォロー・メトリクス取得

FANZA API（DMM）:
  - DMM_API_ID / DMM_AFFILIATE_ID
  - /fanza/items, /fanza/samples などで商品取得

OpenAI:
  - GPT-4o: ツイート文・エロ小説生成、MyFansキャプション生成
  - モデル: gpt-4o（高品質）・gpt-4o-mini（コスト節約）

fal.ai（画像生成）:
  - FAL_KEY
  - FLUX系モデルで実写風AI画像生成
  - imageScorerで品質スコアリング

Rebrandly（URL短縮）:
  - REBRANDLY_API_KEY
  - FANZAのアフィリエイトURLを短縮

Google Sheets:
  - 投稿ログ・アカウントメトリクス・仮説管理を自動記録
  - 6タブ構成

GCS（Google Cloud Storage）:
  - cloudStore.tsで永続化
  - myfans-items.json / 投稿ログ / スナップショット等を保存

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 分析・戦略システム
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
strategy.ts: 
  - パターン分析から最適なコンテンツ戦略を自動調整
  - 仮説（9件）を管理してABテスト的に評価
  - 監視間隔: 8時間ごとに評価・適応

weekly-review.ts:
  - 週次レビューで投稿パフォーマンスを総括
  - 改善提案をAIが自動生成

auto-meeting.ts（会議室機能）:
  - AI間の仮想ミーティングでコンテンツ戦略を議論
  - リサーチ20件 / 会議10件 / 決定事項55件が現在アクティブ

watchdog.ts:
  - isPosting フラグが固まった場合に自動リセット
  - 投稿プロセスの異常を検知・回復

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ Discordボット機能一覧
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
スラッシュコマンド:
  /status   → ボット状態サマリーを表示
  /queue    → 待機中キューを最大5件表示（承認ボタン付き）
  /approve [id] → IDを指定して承認
  /reject [id]  → IDを指定して却下
  /dryrun   → DRY_RUNモードをトグル
  /pause    → 緊急停止（自動投稿OFF）
  /resume   → 再開（自動投稿ON）
  /clear    → このチャンネルの会話履歴をリセット
  /analyze-user [username] [count] [save-insight] → ★手動投稿分析★ ユーザー名でXを直接検索して全投稿分析
  /post [type]      → 通常生成してキューに追加
  /post-smart [type] [with-image] → ★推奨★ インサイト+トレンド+実績参照のスマート生成
  /analyze [days]   → カテゴリ別パフォーマンス分析 + 比率反映ボタン
  /analyze-own [days] → 自分の投稿TOP・ワーストを詳細表示 + インサイト保存ボタン
  /trending [refresh] → 外部トレンドTOP8表示 + インサイト保存・更新ボタン
  /insight [action] [category] → インサイト記憶ストア管理（一覧/コンテキスト確認）

@メンション（このAIエージェント）:
  自由な日本語で話しかけると何でも対応します。
  例: 「キュー見せて」「af2776b5承認して」「今月の状況は？」
  「DRY_RUN解除して」「トレンドを取得して分析して」
  「fanzaをインサイント使って生成して」「7日間の分析結果を保存して」など

利用可能なツール（@メンション時）:
  analyze_user_timeline(username, count, save_insight) → ユーザー名で直接タイムライン取得・分析
  get_own_top_posts(days, n)     → 自分の高インプ投稿TOP N取得
  get_trending_posts(n, refresh)  → 外部トレンド投稿取得（refresh=trueで最新）
  save_insight_memory(...)        → 分析インサイトを永続保存（投稿生成に自動反映）
  get_insight_memory(category)    → 保存済みインサイト取得
  generate_smart_post(type, with_image) → インサイト+トレンド参照のスマート生成
  generate_and_queue(type)        → 通常生成してキューに積む
  analyze_performance(days)       → 投稿パフォーマンス分析
  apply_insights(days)            → 分析結果をカテゴリ比率に反映

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ APIエンドポイント（主要）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GET  /api/healthz          → ヘルスチェック
GET  /api/queue            → キュー一覧
POST /api/queue/:id/approve → キュー承認
POST /api/queue/:id/reject  → キュー却下
GET  /api/status           → ボット総合状態
GET  /api/myfans/items     → MyFansアイテム一覧
POST /api/myfans/ingest    → クリエイターデータ登録（MYFANS_INGEST_SECRET）
POST /api/myfans/:id/generate → キャプション生成
POST /api/myfans/:id/approve  → アイテム承認
POST /api/myfans/:id/queue    → キューに送信
GET  /api/run-config       → 実行設定取得
POST /api/run-config       → 実行設定更新

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 重要な注意事項
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- DRY_RUNはデフォルトON。本番投稿したい場合は /dryrun で解除
- 本番モードで承認すると実際にTwitterに投稿される（取り消し不可）
- MANUAL_ONLYモード中は自動投稿OFF。承認しないと投稿されない
- アフィリエイトリンクは連続で投稿しない（BANリスク）
- @fanza_poll_labは手動専用。ボットのAPIで操作しない

何でも気軽に聞いてください。操作が必要なら実行します。`;
}

async function handleAgentMessage(channelId: string, userMessage: string): Promise<string> {
  // 履歴を取得・更新
  if (!conversationHistory.has(channelId)) {
    conversationHistory.set(channelId, []);
  }
  const history = conversationHistory.get(channelId)!;
  history.push({ role: 'user', content: userMessage });

  // 最大履歴数を超えたら古いものを削除
  while (history.length > MAX_HISTORY) history.shift();

  try {
    // アgentic ループ（ツール呼び出しが完了するまで繰り返す）
    const messages: Anthropic.MessageParam[] = history.map(h => ({
      role: h.role,
      content: h.content,
    }));

    let finalText = '';

    for (let loop = 0; loop < 5; loop++) {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        system: buildSystemPrompt(),
        messages,
        tools: AGENT_TOOLS,
        max_tokens: 1024,
      });

      if (response.stop_reason === 'end_turn') {
        // テキスト応答を取得
        finalText = response.content
          .filter(b => b.type === 'text')
          .map(b => (b as any).text)
          .join('');
        break;
      }

      if (response.stop_reason === 'tool_use') {
        // ツール呼び出しブロックを処理
        const assistantContent = response.content;
        messages.push({ role: 'assistant', content: assistantContent });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of assistantContent) {
          if (block.type === 'tool_use') {
            const result = await executeTool(block.name, block.input as Record<string, any>);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result,
            });
          }
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // その他のstop_reason（max_tokens等）
      finalText = response.content
        .filter(b => b.type === 'text')
        .map(b => (b as any).text)
        .join('') || '（応答を生成できませんでした）';
      break;
    }

    if (!finalText) finalText = '処理が完了しましたが、応答テキストがありませんでした。';

    // 履歴にアシスタント応答を追加
    history.push({ role: 'assistant', content: finalText });
    while (history.length > MAX_HISTORY) history.shift();

    return finalText;
  } catch (e: any) {
    console.error('[Discord Agent] Claude呼び出しエラー:', e.message);
    return `⚠ エラーが発生しました: ${e.message}`;
  }
}

// ─── スラッシュコマンド定義 ────────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('ボットの現在状態を表示'),
  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('待機中の投稿キューを表示'),
  new SlashCommandBuilder()
    .setName('approve')
    .setDescription('キューアイテムを承認して投稿')
    .addStringOption(o =>
      o.setName('id').setDescription('queue_id（先頭8文字でもOK）').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('reject')
    .setDescription('キューアイテムを却下')
    .addStringOption(o =>
      o.setName('id').setDescription('queue_id（先頭8文字でもOK）').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('dryrun')
    .setDescription('DRY_RUNモードをトグル'),
  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('⚠ 緊急停止 — 全自動投稿を停止'),
  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('投稿を再開'),
  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('このチャンネルの会話履歴をリセット'),
  new SlashCommandBuilder()
    .setName('analyze-user')
    .setDescription('🔍 ユーザー名でXを直接検索して全投稿（手動含む）を分析')
    .addStringOption(o =>
      o.setName('username').setDescription('Xユーザー名（@なし）').setRequired(true),
    )
    .addIntegerOption(o =>
      o.setName('count').setDescription('取得件数（デフォルト30、最大100）'),
    )
    .addBooleanOption(o =>
      o.setName('save-insight').setDescription('trueでトップパターンをインサイトに保存'),
    ),
  new SlashCommandBuilder()
    .setName('analyze-own')
    .setDescription('自分の投稿パフォーマンスを詳細分析')
    .addIntegerOption(o =>
      o.setName('days').setDescription('分析期間').addChoices(
        { name: '7日間', value: 7 },
        { name: '14日間', value: 14 },
        { name: '30日間', value: 30 },
      ),
    ),
  new SlashCommandBuilder()
    .setName('trending')
    .setDescription('X上の伸びてる投稿を取得・分析')
    .addBooleanOption(o =>
      o.setName('refresh').setDescription('最新データに更新してから表示（30秒程度かかります）'),
    ),
  new SlashCommandBuilder()
    .setName('insight')
    .setDescription('記憶ストアのインサイト管理')
    .addStringOption(o =>
      o.setName('action').setDescription('操作').setRequired(true)
        .addChoices(
          { name: '一覧表示', value: 'list' },
          { name: '生成に使われるコンテキスト確認', value: 'context' },
        ),
    )
    .addStringOption(o =>
      o.setName('category').setDescription('絞り込みカテゴリ')
        .addChoices(
          { name: '自分の投稿', value: 'own-post' },
          { name: 'トレンド', value: 'trending' },
          { name: '競合分析', value: 'competitor' },
          { name: 'メディア', value: 'media' },
          { name: '戦略', value: 'strategy' },
        ),
    ),
  new SlashCommandBuilder()
    .setName('post-smart')
    .setDescription('📊 分析インサイト+トレンドを反映したスマート生成（推奨）')
    .addStringOption(o =>
      o.setName('type').setDescription('コンテンツタイプ').setRequired(true)
        .addChoices(
          { name: '💬 エンゲージ（インプ最大化）', value: 'engagement' },
          { name: '🔞 FANZA（高評価作品アフィリ）', value: 'fanza' },
          { name: '📖 猥談', value: 'erotic-story' },
          { name: '💗 MyFans', value: 'myfans' },
        ),
    )
    .addBooleanOption(o =>
      o.setName('with-image').setDescription('画像付き（FANZA=サンプル画像 / 他=AI生成）'),
    ),
  new SlashCommandBuilder()
    .setName('post')
    .setDescription('コンテンツを生成してキューに追加（承認ボタン付き）')
    .addStringOption(o =>
      o.setName('type')
        .setDescription('コンテンツタイプ')
        .setRequired(true)
        .addChoices(
          { name: '💬 エンゲージ（共感・インプ稼ぎ）', value: 'engagement' },
          { name: '🔞 FANZA（アフィリエイト）', value: 'fanza' },
          { name: '📖 猥談（エロ短編）', value: 'erotic-story' },
          { name: '💗 MyFans', value: 'myfans' },
        ),
    ),
  new SlashCommandBuilder()
    .setName('analyze')
    .setDescription('投稿パフォーマンスをカテゴリ別に分析して表示')
    .addIntegerOption(o =>
      o.setName('days')
        .setDescription('分析期間（日数）')
        .addChoices(
          { name: '7日間', value: 7 },
          { name: '14日間', value: 14 },
          { name: '30日間', value: 30 },
        ),
    ),
].map(c => c.toJSON());

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

function typeEmoji(type: string): string {
  const m: Record<string, string> = {
    myfans: '💗', fanza: '🔞', engagement: '💬',
    'erotic-story': '📖', emergency: '🚨',
  };
  return m[type] ?? '📌';
}

function shortId(id: string) { return id.slice(0, 8); }

function buildQueueEmbed(item: QueueItem): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(item.type === 'myfans' ? 0xff6b9d : item.type === 'fanza' ? 0xff8c00 : 0x5865f2)
    .setTitle(`${typeEmoji(item.type)} 新しい投稿キュー — ${item.itemTitle ?? item.type}`)
    .setDescription(item.text.slice(0, 300) + (item.text.length > 300 ? '…' : ''))
    .addFields(
      { name: 'タイプ', value: item.type, inline: true },
      { name: 'ID', value: `\`${shortId(item.id)}\``, inline: true },
      ...(item.affiliateUrl ? [{ name: 'アフィリエイトURL', value: item.affiliateUrl.slice(0, 100) }] : []),
    )
    .setTimestamp();
}

function buildApproveRow(itemId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve:${itemId}`)
      .setLabel('✅ 承認して投稿')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`reject:${itemId}`)
      .setLabel('❌ 却下')
      .setStyle(ButtonStyle.Danger),
  );
}

// ─── キュー通知 ───────────────────────────────────────────────────────────────

export async function notifyQueue(item: QueueItem): Promise<void> {
  if (!client?.isReady()) return;
  const cfg = getRunConfig();
  if (!cfg.discordNotifyEnabled) return;
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel?.isTextBased()) return;
    await (channel as any).send({
      embeds: [buildQueueEmbed(item)],
      components: [buildApproveRow(item.id)],
    });
  } catch (e: any) {
    console.error('[Discord] 通知失敗:', e.message);
  }
}

export async function sendDiscordMessage(text: string): Promise<void> {
  if (!client?.isReady()) return;
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel?.isTextBased()) return;
    await (channel as any).send(text);
  } catch (e: any) {
    console.error('[Discord] メッセージ送信失敗:', e.message);
  }
}

// ─── スラッシュコマンドハンドラー ─────────────────────────────────────────────

async function handleSlash(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply({ ephemeral: true });

  switch (i.commandName) {

    case 'status': {
      const cfg = getRunConfig();
      const stats = getQueueStats();
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🤖 FANZA Bot — 現在の状態')
        .addFields(
          { name: '🧪 DRY_RUN', value: cfg.dryRun ? 'ON（テスト）' : 'OFF（本番）', inline: true },
          { name: '🚀 自動投稿', value: cfg.autoPostEnabled ? 'ON' : 'OFF', inline: true },
          { name: '🔔 Discord通知', value: cfg.discordNotifyEnabled ? 'ON' : 'OFF', inline: true },
          { name: '📬 待機中', value: String(stats.pending), inline: true },
          { name: '✅ 投稿済', value: String(stats.posted), inline: true },
          { name: '🧪 DRY済', value: String(stats.dry_run), inline: true },
          { name: '⚙ 日上限', value: `${cfg.maxPostsPerDay}件/日`, inline: true },
          { name: '⏱ クールダウン', value: `${cfg.cooldownMinutes}分`, inline: true },
          { name: '🛡 安全度', value: cfg.safetyStrictness, inline: true },
        )
        .setTimestamp();
      await i.editReply({ embeds: [embed] });
      break;
    }

    case 'queue': {
      const pending = getQueue(['pending']);
      if (pending.length === 0) {
        await i.editReply('📭 待機中のキューはありません。');
        return;
      }
      const show = pending.slice(0, 5);
      await i.editReply({
        content: `📬 待機中: **${pending.length}件**（最大5件表示）`,
        embeds: show.map(buildQueueEmbed),
        components: show.map(it => buildApproveRow(it.id)),
      });
      break;
    }

    case 'approve': {
      const input = i.options.getString('id', true).trim();
      const all = getQueue();
      const item = all.find(q => q.id === input || q.id.startsWith(input));
      if (!item) { await i.editReply(`❌ ID \`${input}\` が見つかりません。`); return; }
      const result = approveQueueItem(item.id);
      if (!result) { await i.editReply('❌ 承認失敗。'); return; }
      await i.editReply(`✅ 承認しました — \`${shortId(item.id)}\` (${item.type})`);
      break;
    }

    case 'reject': {
      const input = i.options.getString('id', true).trim();
      const all = getQueue();
      const item = all.find(q => q.id === input || q.id.startsWith(input));
      if (!item) { await i.editReply(`❌ ID \`${input}\` が見つかりません。`); return; }
      rejectQueueItem(item.id);
      await i.editReply(`🚫 却下しました — \`${shortId(item.id)}\``);
      break;
    }

    case 'dryrun': {
      const cfg = getRunConfig();
      const newVal = !cfg.dryRun;
      updateRunConfig({ dryRun: newVal });
      await i.editReply(newVal
        ? '🧪 **DRY_RUN ON** — 実際には投稿されません。'
        : '🟢 **DRY_RUN OFF（本番）** — 承認されたキューはXへ投稿されます。');
      break;
    }

    case 'pause': {
      updateRunConfig({ autoPostEnabled: false });
      await i.editReply('🛑 **緊急停止** — 自動投稿をOFFにしました。');
      break;
    }

    case 'resume': {
      updateRunConfig({ autoPostEnabled: true });
      await i.editReply('▶️ **再開** — 自動投稿をONにしました。');
      break;
    }

    case 'clear': {
      conversationHistory.delete(i.channelId);
      await i.editReply('🗑 会話履歴をリセットしました。');
      break;
    }

    case 'analyze-user': {
      const targetUser = i.options.getString('username', true).replace(/^@/, '');
      const fetchCount = Math.min(i.options.getInteger('count') ?? 30, 100);
      const doSaveInsight = i.options.getBoolean('save-insight') ?? false;

      await i.editReply({ content: `⏳ @${targetUser} のタイムラインを取得中... (${fetchCount}件)` });

      let tweets: Awaited<ReturnType<typeof fetchUserTimelineByUsername>>;
      try {
        tweets = await fetchUserTimelineByUsername(targetUser, fetchCount);
      } catch (e: any) {
        await i.editReply(`❌ @${targetUser} の取得失敗: ${e.message}`);
        return;
      }

      if (tweets.length === 0) {
        await i.editReply(`📭 @${targetUser} に投稿が見つかりませんでした。`);
        return;
      }

      const sorted = [...tweets].sort((a, b) => b.impression_count - a.impression_count);
      const top5   = sorted.slice(0, 5);

      const totalImp  = tweets.reduce((s, t) => s + t.impression_count, 0);
      const totalLike = tweets.reduce((s, t) => s + t.like_count, 0);
      const totalRT   = tweets.reduce((s, t) => s + t.retweet_count, 0);
      const avgImp    = Math.round(totalImp  / tweets.length);
      const avgLike   = Math.round(totalLike / tweets.length);
      const avgRT     = Math.round(totalRT   / tweets.length);

      const topFields = top5.map((t, idx) => ({
        name: `🏆 TOP${idx + 1} — インプ${t.impression_count.toLocaleString()} / いいね${t.like_count} / RT${t.retweet_count}`,
        value: t.text.slice(0, 200) + (t.text.length > 200 ? '…' : ''),
        inline: false,
      }));

      // 時間帯分布
      const hourDist: Record<number, number> = {};
      for (const t of tweets) {
        const h = new Date(t.createdAt).getUTCHours() + 9; // JST
        const jst = h >= 24 ? h - 24 : h;
        hourDist[jst] = (hourDist[jst] ?? 0) + 1;
      }
      const topHour = Object.entries(hourDist).sort((a, b) => Number(b[1]) - Number(a[1]))[0];

      // エンゲージ率（いいね+RT / インプ）
      const engRate = totalImp > 0
        ? ((totalLike + totalRT) / totalImp * 100).toFixed(2)
        : '0';

      const embed = new EmbedBuilder()
        .setColor(0xe91e8c)
        .setTitle(`🔍 @${targetUser} タイムライン分析 — ${tweets.length}件`)
        .addFields(
          { name: '平均インプレッション', value: avgImp.toLocaleString(), inline: true },
          { name: '平均いいね',           value: String(avgLike),         inline: true },
          { name: '平均RT',               value: String(avgRT),           inline: true },
          { name: 'エンゲージ率',         value: `${engRate}%`,           inline: true },
          { name: '最多投稿時間帯 (JST)', value: topHour ? `${topHour[0]}時台 (${topHour[1]}件)` : '不明', inline: true },
          { name: '\u200b',               value: '\u200b',                inline: true },
          ...topFields,
        )
        .setFooter({ text: doSaveInsight ? '✅ トップパターンをインサイトに保存済み' : '💡 「インサイット保存」でAI生成に反映できます' })
        .setTimestamp();

      // インサイット保存
      if (doSaveInsight && top5.length > 0) {
        const topSummary = top5.map((t, idx) =>
          `TOP${idx + 1}(インプ${t.impression_count}/いいね${t.like_count}): ${t.text.slice(0, 70)}`,
        ).join('\n');
        saveInsight(
          'own-post',
          `@${targetUser} TOP投稿パターン（直近${tweets.length}件）`,
          topSummary,
          ['timeline-analysis', targetUser, 'manual-post'],
          75,
          `@${targetUser}`,
        );
      }

      const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`save_timeline_insight:${targetUser}:${fetchCount}`)
          .setLabel('⚡ トップパターンをインサイト保存')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`smart_regen:engagement:false`)
          .setLabel('🧠 このデータでスマート生成')
          .setStyle(ButtonStyle.Success),
      );

      await i.editReply({ content: '', embeds: [embed], components: [actionRow] });
      break;
    }

    case 'analyze-own': {
      const ownDays = i.options.getInteger('days') ?? 14;
      const records = getAnalytics(ownDays)
        .filter(r => r.result === 'posted')
        .sort((a, b) => b.impressions - a.impressions || b.likes - a.likes);
      const stats = getAnalyticsStats(ownDays);

      if (records.length === 0) {
        await i.editReply(`📭 過去${ownDays}日間に本番投稿がありません。DRY_RUNを解除して投稿してください。`);
        return;
      }

      const top3 = records.slice(0, 3);

      const topFields = top3.map((r, idx) => ({
        name: `🏆 TOP${idx + 1} (インプ${r.impressions.toLocaleString()})`,
        value: `${r.text.slice(0, 80)}…\nいいね${r.likes} RT${r.reposts} クリック${r.clicks}`,
        inline: false,
      }));

      const catStats = getPerformanceByCategory(ownDays);
      const catSummary = Object.entries(catStats)
        .sort((a, b) => b[1].avgImpressions - a[1].avgImpressions)
        .map(([cat, d]) => `${typeEmoji(cat)} ${cat}: ${d.count}件 / 平均インプ${d.avgImpressions}`)
        .join('\n') || '（データなし）';

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`📊 自分の投稿分析 — 過去${ownDays}日間`)
        .addFields(
          { name: '投稿数', value: `${records.length}件（うち本番${stats.posted}件）`, inline: true },
          { name: '平均インプ', value: stats.avgImpressions.toLocaleString(), inline: true },
          { name: '平均いいね', value: String(stats.avgLikes), inline: true },
          { name: '📈 カテゴリ別実績', value: catSummary, inline: false },
          ...topFields,
        )
        .setFooter({ text: '「⚡ インサイト保存」で記憶ストアに学習内容を記録できます' })
        .setTimestamp();

      const saveRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`save_own_insight:${ownDays}`)
          .setLabel('⚡ トップパターンをインサイト保存')
          .setStyle(ButtonStyle.Primary),
      );

      await i.editReply({ embeds: [embed], components: [saveRow] });
      break;
    }

    case 'trending': {
      const doRefresh = i.options.getBoolean('refresh') ?? false;
      if (doRefresh) {
        await i.editReply({ content: '⏳ 最新トレンドデータを取得中... (30秒程度かかります)' });
        try {
          await refreshExternalPatterns();
        } catch (e: any) {
          console.error('[Discord] trending refresh失敗:', e.message);
        }
      }

      const patterns = getExternalTopPatterns(8);
      if (patterns.length === 0) {
        await i.editReply('📭 トレンドデータがありません。`/trending refresh:true` で取得してください。');
        return;
      }

      const lastRefresh = patterns[0]?.savedAt
        ? new Date(patterns[0].savedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
        : '不明';

      const patternFields = patterns.slice(0, 5).map((p, idx) => ({
        name: `🔥 TOP${idx + 1} スコア${p.score} (${p.source})`,
        value: `${p.text.slice(0, 100)}\n👍${p.like_count} 🔁${p.retweet_count} 👁${p.impression_count ?? '?'}`,
        inline: false,
      }));

      const embed = new EmbedBuilder()
        .setColor(0xf0a500)
        .setTitle(`🔥 外部トレンド投稿 TOP8`)
        .setDescription(`最終更新: ${lastRefresh} JST`)
        .addFields(...patternFields)
        .setFooter({ text: '「📝 インサイト保存」でこのパターンの学びを記録' })
        .setTimestamp();

      const trendRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('save_trend_insight:all')
          .setLabel('📝 トップパターンをインサイト保存')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('trend_refresh:1')
          .setLabel('🔄 最新データに更新')
          .setStyle(ButtonStyle.Secondary),
      );

      await i.editReply({ content: '', embeds: [embed], components: [trendRow] });
      break;
    }

    case 'insight': {
      const action = i.options.getString('action', true);
      const cat = i.options.getString('category') as InsightRecord['category'] | null;
      const summary = getInsightSummary();

      if (action === 'context') {
        const ctx = buildInsightContext(10);
        const embed = new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle('🧠 生成コンテキスト（現在の投稿AIが参照するインサイト）')
          .setDescription(ctx.slice(0, 3000) || '（インサイトなし。/analyze-own や /trending で分析後、ボタンで保存してください）')
          .setTimestamp();
        await i.editReply({ embeds: [embed] });
        return;
      }

      const items = getInsights(cat ?? undefined, 10);
      if (items.length === 0) {
        await i.editReply(`🗃 インサイトが${cat ? `「${cat}」カテゴリに` : ''}ありません。\n\`/analyze-own\` や \`/trending\` で分析後、「インサイト保存」ボタンを押してください。`);
        return;
      }

      const fields = items.slice(0, 8).map(ins => ({
        name: `[${ins.category}] ${ins.title} (重要度${ins.score})`,
        value: `${ins.content.slice(0, 120)}\nタグ: ${ins.tags.join(', ') || 'なし'} | 使用${ins.usedCount}回`,
        inline: false,
      }));

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(`🧠 インサイト記憶ストア`)
        .addFields(
          { name: '保存数', value: `${summary.total}件`, inline: true },
          { name: '最終更新', value: summary.lastUpdatedAt ? new Date(summary.lastUpdatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : 'なし', inline: true },
          { name: 'カテゴリ別', value: Object.entries(summary.byCategory).map(([k, v]) => `${k}:${v}`).join(' / ') || 'なし', inline: false },
          ...fields,
        )
        .setTimestamp();

      await i.editReply({ embeds: [embed] });
      break;
    }

    case 'post-smart': {
      const smartType = i.options.getString('type', true) as 'engagement' | 'fanza' | 'erotic-story' | 'myfans';
      const withImage = i.options.getBoolean('with-image') ?? false;

      await i.editReply({ content: `⏳ ${typeEmoji(smartType)} **スマート生成中...** インサイト+トレンド+実績データを参照しています` });

      try {
        const result = await manualGenerateSmartPost(smartType, withImage);
        const insightCount = getInsightSummary().total;
        const trendCount = getExternalTopPatterns(1).length;

        const embed = new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle(`🧠✨ スマート生成完了 — ${result.itemTitle ?? smartType}`)
          .setDescription(result.text.slice(0, 1000) + (result.text.length > 1000 ? '…' : ''))
          .addFields(
            { name: 'タイプ', value: smartType, inline: true },
            { name: 'キューID', value: `\`${shortId(result.queueId)}\``, inline: true },
            { name: '参照データ', value: `インサイト${insightCount}件 / トレンド${trendCount > 0 ? 'あり' : 'なし'}`, inline: true },
            ...(result.affiliateUrl ? [{ name: 'URL', value: result.affiliateUrl.slice(0, 100) }] : []),
            ...(result.imageUrl ? [{ name: '画像', value: result.imageUrl.slice(0, 100) }] : []),
          )
          .setFooter({ text: '通常の/postより高品質な生成（インサイト・実績参照済）' })
          .setTimestamp();

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`push:${result.queueId}`)
            .setLabel('✅ 承認して投稿待ちへ')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`smart_regen:${smartType}:${withImage}`)
            .setLabel('🔄 再スマート生成')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`reject:${result.queueId}`)
            .setLabel('❌ 却下')
            .setStyle(ButtonStyle.Danger),
        );

        await i.editReply({ content: '', embeds: [embed], components: [row] });
      } catch (e: any) {
        await i.editReply(`❌ スマート生成失敗: ${e.message}`);
      }
      break;
    }

    case 'post': {
      const postType = i.options.getString('type', true) as 'engagement' | 'fanza' | 'erotic-story' | 'myfans';
      await i.editReply({ content: `⏳ ${typeEmoji(postType)} **${postType}** を生成中...` });
      try {
        const result = await manualGenerateAndQueue(postType);
        const embed = new EmbedBuilder()
          .setColor(postType === 'fanza' ? 0xff8c00 : postType === 'myfans' ? 0xff6b9d : 0x5865f2)
          .setTitle(`${typeEmoji(postType)} 生成完了 — ${result.itemTitle ?? postType}`)
          .setDescription(result.text.slice(0, 1000) + (result.text.length > 1000 ? '…' : ''))
          .addFields(
            { name: 'タイプ', value: postType, inline: true },
            { name: 'キューID', value: `\`${shortId(result.queueId)}\``, inline: true },
            ...(result.affiliateUrl ? [{ name: 'URL', value: result.affiliateUrl.slice(0, 100) }] : []),
          )
          .setFooter({ text: '承認すると次のスロットで自動投稿されます' })
          .setTimestamp();

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`push:${result.queueId}`)
            .setLabel('✅ 承認して投稿待ちへ')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`regen:${postType}`)
            .setLabel('🔄 再生成')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`reject:${result.queueId}`)
            .setLabel('❌ 却下')
            .setStyle(ButtonStyle.Danger),
        );

        await i.editReply({ content: '', embeds: [embed], components: [row] });
      } catch (e: any) {
        await i.editReply(`❌ 生成失敗: ${e.message}`);
      }
      break;
    }

    case 'analyze': {
      const days = i.options.getInteger('days') ?? 7;
      const stats = getAnalyticsStats(days);
      const byCategory = getPerformanceByCategory(days);

      const catFields = Object.entries(byCategory).map(([cat, data]) => ({
        name: `${typeEmoji(cat)} ${cat}`,
        value: `件数: ${data.count}件\nインプ平均: ${data.avgImpressions.toLocaleString()}\nいいね平均: ${data.avgLikes}\nRT平均: ${data.avgReposts}\nクリック合計: ${data.totalClicks}`,
        inline: true,
      }));

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(`📊 投稿パフォーマンス分析 — 過去${days}日間`)
        .addFields(
          { name: '総投稿数', value: String(stats.total), inline: true },
          { name: '実投稿', value: String(stats.posted), inline: true },
          { name: 'DRY_RUN', value: String(stats.dryRun), inline: true },
          { name: '平均インプ', value: stats.avgImpressions.toLocaleString(), inline: true },
          { name: '平均いいね', value: String(stats.avgLikes), inline: true },
          { name: 'TOP カテゴリ', value: stats.topCategory, inline: true },
          ...catFields,
        )
        .setFooter({ text: '「⚡ 生成に反映」で分析結果をカテゴリ比率に適用します' })
        .setTimestamp();

      const applyRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`apply_insights:${days}`)
          .setLabel('⚡ 生成設定に反映')
          .setStyle(ButtonStyle.Primary),
      );

      await i.editReply({
        embeds: [embed],
        components: catFields.length > 0 ? [applyRow] : [],
      });
      break;
    }

    default:
      await i.editReply('⚠ 不明なコマンドです。');
  }
}

// ─── ボタンハンドラー ─────────────────────────────────────────────────────────

async function handleButton(i: ButtonInteraction): Promise<void> {
  // customId は "action:payload" 形式（payloadにコロンが含まれる場合あり）
  const colonIdx = i.customId.indexOf(':');
  const action = colonIdx >= 0 ? i.customId.slice(0, colonIdx) : i.customId;
  const payload = colonIdx >= 0 ? i.customId.slice(colonIdx + 1) : '';

  await i.deferUpdate();

  // ── 既存: キュー承認 / 却下 ──
  if (action === 'approve') {
    const result = approveQueueItem(payload);
    await i.editReply({
      content: result
        ? `✅ **@${i.user.username}** が承認しました — \`${shortId(payload)}\``
        : '❌ 承認失敗（既に処理済み？）',
      embeds: [], components: [],
    });

  } else if (action === 'reject') {
    rejectQueueItem(payload);
    await i.editReply({
      content: `🚫 **@${i.user.username}** が却下しました — \`${shortId(payload)}\``,
      embeds: [], components: [],
    });

  // ── /post から: 承認ボタン ──
  } else if (action === 'push') {
    const result = approveQueueItem(payload);
    await i.editReply({
      content: result
        ? `✅ **@${i.user.username}** が承認 → 投稿待ちキューへ追加 \`${shortId(payload)}\`\n次のスロットで自動投稿されます。`
        : '❌ 承認失敗（既に処理済みまたは期限切れ）',
      embeds: [], components: [],
    });

  // ── /post から: 再生成ボタン ──
  } else if (action === 'regen') {
    const regenType = payload as 'engagement' | 'fanza' | 'erotic-story' | 'myfans';
    try {
      const result = await manualGenerateAndQueue(regenType);
      const embed = new EmbedBuilder()
        .setColor(regenType === 'fanza' ? 0xff8c00 : regenType === 'myfans' ? 0xff6b9d : 0x5865f2)
        .setTitle(`${typeEmoji(regenType)} 再生成完了 — ${result.itemTitle ?? regenType}`)
        .setDescription(result.text.slice(0, 1000) + (result.text.length > 1000 ? '…' : ''))
        .addFields(
          { name: 'タイプ', value: regenType, inline: true },
          { name: 'キューID', value: `\`${shortId(result.queueId)}\``, inline: true },
        )
        .setFooter({ text: '承認すると次のスロットで自動投稿されます' })
        .setTimestamp();

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`push:${result.queueId}`)
          .setLabel('✅ 承認して投稿待ちへ')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`regen:${regenType}`)
          .setLabel('🔄 もう一度再生成')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`reject:${result.queueId}`)
          .setLabel('❌ 却下')
          .setStyle(ButtonStyle.Danger),
      );

      await i.editReply({ content: '', embeds: [embed], components: [row] });
    } catch (e: any) {
      await i.editReply({ content: `❌ 再生成失敗: ${e.message}`, embeds: [], components: [] });
    }

  // ── /analyze-user から: タイムライン分析結果をインサイト保存 ──
  } else if (action === 'save_timeline_insight') {
    const [tlUser, tlCountStr] = payload.split(':');
    const tlCount = parseInt(tlCountStr ?? '30', 10);
    await i.editReply({ content: `⏳ @${tlUser} のタイムラインを再取得してインサイット保存中...`, embeds: [], components: [] });
    try {
      const tlTweets = await fetchUserTimelineByUsername(tlUser, tlCount);
      const tlSorted = [...tlTweets].sort((a, b) => b.impression_count - a.impression_count).slice(0, 5);
      if (tlSorted.length === 0) {
        await i.editReply({ content: '⚠ 投稿データが不足しています。', embeds: [], components: [] });
        return;
      }
      const tlSummary = tlSorted.map((t, idx) =>
        `TOP${idx + 1}(インプ${t.impression_count}/いいね${t.like_count}/RT${t.retweet_count}): ${t.text.slice(0, 70)}`,
      ).join('\n');
      const ins = saveInsight(
        'own-post',
        `@${tlUser} TOP投稿パターン（直近${tlTweets.length}件）`,
        tlSummary,
        ['timeline-analysis', tlUser, 'manual-post'],
        75,
        `@${tlUser}`,
      );
      await i.editReply({
        content: `✅ インサイット保存完了\n\n🧠 「${ins.title}」を記憶ストアに追加しました。\n次回の \`/post-smart\` で自動参照されます。`,
        embeds: [], components: [],
      });
    } catch (e: any) {
      await i.editReply({ content: `❌ 取得失敗: ${e.message}`, embeds: [], components: [] });
    }

  // ── /analyze-own から: 自分のトップパターンをインサイト保存 ──
  } else if (action === 'save_own_insight') {
    const saveDays = parseInt(payload, 10) || 14;
    const records = getAnalytics(saveDays)
      .filter(r => r.result === 'posted' && r.impressions > 0)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 3);
    if (records.length === 0) {
      await i.editReply({ content: '⚠ 本番投稿データが不足しています。', embeds: [], components: [] });
      return;
    }
    const topText = records.map((r, idx) => `TOP${idx + 1}(インプ${r.impressions}): ${r.text.slice(0, 80)}`).join('\n');
    const ins = saveInsight(
      'own-post',
      `自分のTOP投稿パターン（${saveDays}日間）`,
      topText,
      ['top-post', 'high-impression'],
      70,
      '@ero_senpai1',
    );
    await i.editReply({
      content: `✅ **@${i.user.username}** がインサイトを保存しました\n\n🧠 「${ins.title}」を記憶ストアに追加。次回の \`/post-smart\` から自動参照されます。`,
      embeds: [], components: [],
    });

  // ── /trending から: トップパターンをインサイト保存 ──
  } else if (action === 'save_trend_insight') {
    const patterns = getExternalTopPatterns(5);
    if (patterns.length === 0) {
      await i.editReply({ content: '⚠ トレンドデータがありません。', embeds: [], components: [] });
      return;
    }
    const summary = patterns
      .slice(0, 3)
      .map((p, idx) => `TOP${idx + 1}(スコア${p.score}): ${p.text.slice(0, 80)}`)
      .join('\n');
    const ins = saveInsight(
      'trending',
      `Xトレンドパターン（スコア${patterns[0].score}〜${patterns[patterns.length - 1].score}）`,
      summary,
      ['trending', 'high-score', patterns[0].source],
      75,
      patterns[0].source,
    );
    await i.editReply({
      content: `✅ **@${i.user.username}** がトレンドインサイトを保存\n\n🧠 「${ins.title}」を記憶ストアに追加。次回の \`/post-smart\` から自動参照されます。`,
      embeds: [], components: [],
    });

  // ── /trending から: 最新データ更新ボタン ──
  } else if (action === 'trend_refresh') {
    await i.editReply({ content: '⏳ 最新トレンドデータを取得中...', embeds: [], components: [] });
    try {
      await refreshExternalPatterns();
      const fresh = getExternalTopPatterns(3);
      await i.editReply({
        content: `✅ トレンドデータ更新完了 (${fresh.length}件取得)\nTOP1: スコア${fresh[0]?.score ?? '?'} - ${fresh[0]?.text?.slice(0, 60) ?? ''}`,
        embeds: [], components: [],
      });
    } catch (e: any) {
      await i.editReply({ content: `❌ 更新失敗: ${e.message}`, embeds: [], components: [] });
    }

  // ── /post-smart から: 再スマート生成ボタン ──
  } else if (action === 'smart_regen') {
    const parts = payload.split(':');
    const regenType = parts[0] as 'engagement' | 'fanza' | 'erotic-story' | 'myfans';
    const withImg = parts[1] === 'true';
    await i.editReply({ content: `⏳ ${typeEmoji(regenType)} 再スマート生成中...`, embeds: [], components: [] });
    try {
      const result = await manualGenerateSmartPost(regenType, withImg);
      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(`🧠✨ 再スマート生成完了 — ${result.itemTitle ?? regenType}`)
        .setDescription(result.text.slice(0, 1000) + (result.text.length > 1000 ? '…' : ''))
        .addFields(
          { name: 'キューID', value: `\`${shortId(result.queueId)}\``, inline: true },
          ...(result.imageUrl ? [{ name: '画像', value: result.imageUrl.slice(0, 80) }] : []),
        )
        .setTimestamp();
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`push:${result.queueId}`).setLabel('✅ 承認').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`smart_regen:${regenType}:${withImg}`).setLabel('🔄 再生成').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`reject:${result.queueId}`).setLabel('❌ 却下').setStyle(ButtonStyle.Danger),
      );
      await i.editReply({ content: '', embeds: [embed], components: [row] });
    } catch (e: any) {
      await i.editReply({ content: `❌ 再生成失敗: ${e.message}`, embeds: [], components: [] });
    }

  // ── /analyze から: 生成設定に反映ボタン ──
  } else if (action === 'apply_insights') {
    const insightDays = parseInt(payload, 10) || 7;
    const byCategory = getPerformanceByCategory(insightDays);
    const cats = Object.entries(byCategory);
    if (cats.length === 0) {
      await i.editReply({
        content: '⚠ 投稿データが不足しているため比率調整をスキップしました。',
        embeds: [], components: [],
      });
      return;
    }
    const scores: Record<string, number> = {
      engagement:    byCategory['engagement']?.avgImpressions    ?? 50,
      fanza:         byCategory['fanza']?.avgImpressions         ?? 30,
      'erotic-story': byCategory['erotic-story']?.avgImpressions ?? 20,
      myfans:        byCategory['myfans']?.avgImpressions        ?? 10,
    };
    const scoreTotal = Object.values(scores).reduce((s, v) => s + v, 0) || 1;
    const base = 5;
    const raw = {
      engagement:  Math.max(base, Math.round((scores['engagement']    / scoreTotal) * 100)),
      eroticStory: Math.max(base, Math.round((scores['erotic-story']  / scoreTotal) * 100)),
      fanza:       Math.max(base, Math.round((scores['fanza']         / scoreTotal) * 100)),
      myfans:      Math.max(base, Math.round((scores['myfans']        / scoreTotal) * 100)),
    };
    const rawTotal = raw.engagement + raw.eroticStory + raw.fanza + raw.myfans;
    const normalized = {
      engagement:  Math.round(raw.engagement  / rawTotal * 100),
      eroticStory: Math.round(raw.eroticStory / rawTotal * 100),
      fanza:       Math.round(raw.fanza       / rawTotal * 100),
      myfans:      100 - Math.round(raw.engagement / rawTotal * 100) - Math.round(raw.eroticStory / rawTotal * 100) - Math.round(raw.fanza / rawTotal * 100),
    };
    updateRunConfig({ categoryWeights: normalized });
    await i.editReply({
      content: `⚡ **生成設定を更新しました** （${insightDays}日間の実績ベース）\n\n💬 エンゲージ **${normalized.engagement}%** / 📖 猥談 **${normalized.eroticStory}%** / 🔞 FANZA **${normalized.fanza}%** / 💗 MyFans **${normalized.myfans}%**`,
      embeds: [], components: [],
    });
  }
}

// ─── メッセージハンドラー（Claude エージェント） ──────────────────────────────

async function handleMessage(message: any): Promise<void> {
  if (message.author.bot) return;
  if (!client?.user) return;

  // @メンションされた時だけ応答
  const isMentioned = message.mentions.has(client.user.id);
  if (!isMentioned) return;

  // メンション部分を除去してテキストを取得
  const content = message.content
    .replace(/<@!?\d+>/g, '')
    .trim();

  if (!content) {
    await message.reply('はい、何でしょう？キュー確認・承認・設定変更など、何でも聞いてください 🤖');
    return;
  }

  try {
    await message.channel.sendTyping();
    const response = await handleAgentMessage(message.channelId, content);

    // 2000文字制限を考慮して分割送信
    if (response.length <= 1900) {
      await message.reply(response);
    } else {
      const chunks = response.match(/.{1,1900}/gs) ?? [response];
      for (const chunk of chunks) {
        await message.channel.send(chunk);
      }
    }
  } catch (e: any) {
    console.error('[Discord Agent] メッセージ処理エラー:', e.message);
    await message.reply('⚠ 処理中にエラーが発生しました。しばらく待ってからもう一度お試しください。');
  }
}

// ─── 初期化 ───────────────────────────────────────────────────────────────────

export async function initDiscordBot(): Promise<void> {
  if (!TOKEN || !CHANNEL_ID || !GUILD_ID) {
    console.log('  ⏭ [Discord] 環境変数未設定のためスキップ');
    return;
  }

  // スラッシュコマンド登録
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    const me = await (rest as any).get(Routes.user()) as any;
    await rest.put(
      Routes.applicationGuildCommands(me.id, GUILD_ID),
      { body: commands },
    );
    console.log('  ✅ [Discord] スラッシュコマンド登録完了');
  } catch (e: any) {
    console.error('  ❌ [Discord] コマンド登録失敗:', e.message);
  }

  // クライアント起動（MessageContent intentが必要）
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`  ✅ [Discord] ログイン完了: ${c.user.tag}`);
    updateRunConfig({ discordNotifyEnabled: true });
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) await handleSlash(interaction);
      else if (interaction.isButton()) await handleButton(interaction);
    } catch (e: any) {
      console.error('[Discord] インタラクション処理エラー:', e.message);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      await handleMessage(message);
    } catch (e: any) {
      console.error('[Discord] メッセージ処理エラー:', e.message);
    }
  });

  client.on(Events.Error, (err) => {
    console.error('[Discord] クライアントエラー:', err.message);
  });

  await client.login(TOKEN);
}
