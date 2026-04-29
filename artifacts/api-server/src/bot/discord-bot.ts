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

  return `あなたは「FANZA/MyFans アフィリエイト二刀流ボット」の管理AIアシスタントです。
Discordでオーナー（あなたに話しかけている人）の窓口として常駐しています。

【現在時刻】${now} JST

【現在のボット状態】
- モード: ${cfg.dryRun ? '🧪 DRY_RUN（テスト）' : '🟢 本番'}
- 自動投稿: ${cfg.autoPostEnabled ? 'ON' : 'OFF'}
- キュー待機中: ${stats.pending}件 / 投稿済: ${stats.posted}件 / 失敗: ${stats.failed}件
- 日上限: ${cfg.maxPostsPerDay}件/日、クールダウン: ${cfg.cooldownMinutes}分

【あなたの役割】
- オーナーの質問に日本語でわかりやすく答える
- 必要に応じてツールを呼び出して実際に操作する（キュー確認・承認・却下・設定変更など）
- ビジネス目標（M5: フォロワー700人 / 月収¥26k超）に向けたアドバイス
- 問題が起きたら原因と対処法を提案する

【運用ルール】
- @fanza_poll_lab: メインアカウント（手動投稿専用）
- @ero_senpai1: サブアカウント（API接続済み、現在MANUAL_ONLYモード）
- 月額コスト: ¥25,799
- DRY_RUNはデフォルトON（安全のため本番投稿前に必ず確認）

簡潔かつ実用的に答えてください。操作が必要な場合はツールを使って実際に実行してください。`;
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
