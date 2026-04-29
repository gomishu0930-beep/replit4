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
];

// ─── ツール実行 ───────────────────────────────────────────────────────────────

function executeTool(name: string, input: Record<string, any>): string {
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

@メンション（このAIエージェント）:
  自由な日本語で話しかけると何でも対応します。
  例: 「キュー見せて」「af2776b5承認して」「今月の状況は？」
  「DRY_RUN解除して」「MyFans draftstatus確認して」など

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
            const result = executeTool(block.name, block.input as Record<string, any>);
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

    default:
      await i.editReply('⚠ 不明なコマンドです。');
  }
}

// ─── ボタンハンドラー ─────────────────────────────────────────────────────────

async function handleButton(i: ButtonInteraction): Promise<void> {
  const [action, itemId] = i.customId.split(':');
  if (!itemId) return;
  await i.deferUpdate();
  if (action === 'approve') {
    const result = approveQueueItem(itemId);
    await i.editReply({
      content: result
        ? `✅ **@${i.user.username}** が承認しました — \`${shortId(itemId)}\``
        : '❌ 承認失敗（既に処理済み？）',
      embeds: [], components: [],
    });
  } else if (action === 'reject') {
    rejectQueueItem(itemId);
    await i.editReply({
      content: `🚫 **@${i.user.username}** が却下しました — \`${shortId(itemId)}\``,
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
