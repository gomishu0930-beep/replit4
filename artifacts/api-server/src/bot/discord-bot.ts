/**
 * discord-bot.ts — Discord ボット統合
 *
 * 機能:
 *  - 投稿キュー追加時に通知（✅承認 / ❌却下 ボタン付き）
 *  - スラッシュコマンド: /status /queue /approve /reject /dryrun /pause /resume
 */

import {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  type Interaction, type ChatInputCommandInteraction,
  type ButtonInteraction, Events,
} from 'discord.js';
import { getQueue, getQueueStats, approveQueueItem, rejectQueueItem, type QueueItem } from './post-queue.js';
import { getRunConfig, updateRunConfig } from './run-config.js';

const TOKEN      = process.env.DISCORD_BOT_TOKEN ?? '';
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID ?? '';
const GUILD_ID   = process.env.DISCORD_GUILD_ID ?? '';

let client: Client | null = null;

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
    .setDescription('DRY_RUNモードをトグル（ONなら実際には投稿しない）'),

  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('⚠ 緊急停止 — 全自動投稿を停止'),

  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('投稿を再開'),
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

// ─── キュー通知（enqueuePost から呼ばれる） ────────────────────────────────────

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

// ─── 汎用メッセージ送信（外部から呼ぶ用） ────────────────────────────────────

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
          { name: '🧪 DRY_RUN', value: cfg.dryRun ? 'ON（テストモード）' : 'OFF（本番）', inline: true },
          { name: '🚀 自動投稿', value: cfg.autoPostEnabled ? 'ON' : 'OFF', inline: true },
          { name: '🔔 Discord通知', value: cfg.discordNotifyEnabled ? 'ON' : 'OFF', inline: true },
          { name: '📬 キュー待機中', value: String(stats.pending), inline: true },
          { name: '✅ 投稿済', value: String(stats.posted), inline: true },
          { name: '🧪 DRY済', value: String(stats.dry_run), inline: true },
          { name: '⚙ 日上限', value: `${cfg.maxPostsPerDay}件/日`, inline: true },
          { name: '⏱ クールダウン', value: `${cfg.cooldownMinutes}分`, inline: true },
          { name: '🛡 安全厳格度', value: cfg.safetyStrictness, inline: true },
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
      if (!item) {
        await i.editReply(`❌ ID \`${input}\` のキューアイテムが見つかりません。`);
        return;
      }
      const result = approveQueueItem(item.id);
      if (!result) {
        await i.editReply('❌ 承認に失敗しました。');
        return;
      }
      await i.editReply(`✅ **承認しました** — \`${shortId(item.id)}\` (${item.type})\n投稿スケジューラーが次のサイクルで投稿します。`);
      break;
    }

    case 'reject': {
      const input = i.options.getString('id', true).trim();
      const all = getQueue();
      const item = all.find(q => q.id === input || q.id.startsWith(input));
      if (!item) {
        await i.editReply(`❌ ID \`${input}\` のキューアイテムが見つかりません。`);
        return;
      }
      rejectQueueItem(item.id);
      await i.editReply(`🚫 **却下しました** — \`${shortId(item.id)}\``);
      break;
    }

    case 'dryrun': {
      const cfg = getRunConfig();
      const newVal = !cfg.dryRun;
      updateRunConfig({ dryRun: newVal });
      await i.editReply(
        newVal
          ? '🧪 **DRY_RUN ON** — 投稿スロットが実行されても実際には投稿されません。'
          : '🟢 **DRY_RUN OFF（本番モード）** — 承認されたキューは実際にXへ投稿されます。',
      );
      break;
    }

    case 'pause': {
      updateRunConfig({ autoPostEnabled: false });
      await i.editReply('🛑 **緊急停止** — 自動投稿をOFFにしました。\n再開するには `/resume` を使ってください。');
      break;
    }

    case 'resume': {
      updateRunConfig({ autoPostEnabled: true });
      await i.editReply('▶️ **再開** — 自動投稿をONにしました。');
      break;
    }

    default:
      await i.editReply('⚠ 不明なコマンドです。');
  }
}

// ─── ボタンインタラクションハンドラー ─────────────────────────────────────────

async function handleButton(i: ButtonInteraction): Promise<void> {
  const [action, itemId] = i.customId.split(':');
  if (!itemId) return;

  await i.deferUpdate();

  if (action === 'approve') {
    const result = approveQueueItem(itemId);
    if (result) {
      await i.editReply({
        content: `✅ **@${i.user.username}** が承認しました — \`${shortId(itemId)}\``,
        embeds: [],
        components: [],
      });
    } else {
      await i.followUp({ content: '❌ 承認失敗（既に処理済みかもしれません）', ephemeral: true });
    }
  } else if (action === 'reject') {
    rejectQueueItem(itemId);
    await i.editReply({
      content: `🚫 **@${i.user.username}** が却下しました — \`${shortId(itemId)}\``,
      embeds: [],
      components: [],
    });
  }
}

// ─── 初期化 ───────────────────────────────────────────────────────────────────

export async function initDiscordBot(): Promise<void> {
  if (!TOKEN || !CHANNEL_ID || !GUILD_ID) {
    console.log('  ⏭ [Discord] 環境変数未設定のためスキップ (DISCORD_BOT_TOKEN / CHANNEL_ID / GUILD_ID)');
    return;
  }

  // スラッシュコマンド登録
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(
      (await (rest as any).get(Routes.user()) as any).id,
      GUILD_ID,
    ), { body: commands });
    console.log('  ✅ [Discord] スラッシュコマンド登録完了');
  } catch (e: any) {
    console.error('  ❌ [Discord] コマンド登録失敗:', e.message);
  }

  // クライアント起動
  client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, (c) => {
    console.log(`  ✅ [Discord] ログイン完了: ${c.user.tag}`);
    updateRunConfig({ discordNotifyEnabled: true });
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleSlash(interaction);
      } else if (interaction.isButton()) {
        await handleButton(interaction);
      }
    } catch (e: any) {
      console.error('[Discord] インタラクション処理エラー:', e.message);
    }
  });

  client.on(Events.Error, (err) => {
    console.error('[Discord] クライアントエラー:', err.message);
  });

  await client.login(TOKEN);
}
