import { getRecentPostIds, updateMetrics, upsertExternalPatterns, getExternalTopPatterns, upsertDynamicTemplates } from './storage.js';
import { getTweetMetrics, searchTweetsByHashtag, fetchUserTimelineByUsername } from './twitter.js';
import Anthropic from '@anthropic-ai/sdk';
import { contact } from './contact.js';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function refreshRecentMetrics() {
  const ids = getRecentPostIds(7);
  if (!ids.length) {
    console.log('  指標更新対象の投稿がありません');
    return;
  }

  console.log(`  ${ids.length} 件の投稿の指標を更新中...`);
  for (const tweetId of ids) {
    const metrics = await getTweetMetrics(tweetId);
    if (metrics) {
      updateMetrics(tweetId, metrics);
      console.log(
        `    ✓ ${tweetId}: ❤${metrics.like_count} 🔁${metrics.retweet_count} 🔖${(metrics as any).bookmark_count ?? '-'}`,
      );
    }
    await sleep(1500);
  }
  console.log('  指標更新完了');
}

// ※ min_faves: はEnterprise専用。Basicプランでは使えないため単純クエリのみ
const SEARCH_QUERIES = [
  '#FANZA',
  '#DMM',
  'FANZA 女優',
  'FANZA おすすめ',
];

// 参照するアカウント一覧（環境変数 TRACK_ACCOUNTS でカンマ区切りで追加可能）
function getTrackAccounts(): string[] {
  const env = process.env.TRACK_ACCOUNTS ?? '';
  return env.split(',').map((s) => s.trim()).filter(Boolean);
}

function calcScore(t: { like_count: number; retweet_count: number; reply_count: number; bookmark_count: number; impression_count: number }): number {
  return t.like_count + t.retweet_count * 3 + t.bookmark_count * 2 + t.reply_count;
}

function isSearchTierError(e: any): boolean {
  const code = e?.code ?? e?.status ?? 0;
  const msg: string = e?.message ?? '';
  return code === 403 || code === 401 || code === 402
    || msg.includes('403') || msg.includes('401') || msg.includes('402')
    || msg.includes('not permitted') || msg.includes('Payment Required');
}

export async function refreshExternalPatterns() {
  console.log('  🔍 外部パターン収集開始...');
  let totalAdded = 0;
  let searchSupported = true;

  // ① ハッシュタグ検索
  if (searchSupported) {
    for (const query of SEARCH_QUERIES) {
      try {
        const tweets = await searchTweetsByHashtag(query, 50);
        const scored = tweets
          .map((t) => ({ ...t, tweetId: t.id, score: calcScore(t) }));
        // スコア0でも収集（エンゲージメントがなくても文章パターンを学習）

        const added = upsertExternalPatterns(scored, query);
        console.log(`    "${query}" → ${tweets.length} 件取得 / ${added} 件新規保存`);
        totalAdded += added;
        await sleep(2000);
      } catch (e: any) {
        if (isSearchTierError(e)) {
          console.warn('    ⚠ 検索 API は現在のプランでは使用できません。アカウント別収集のみ実行します。');
          searchSupported = false;
          break;
        }
        console.warn(`    ⚠ "${query}" 検索失敗: ${e.message}`);
      }
    }
  }

  // ② アカウント別タイムライン取得（TRACK_ACCOUNTS 環境変数で指定）
  const trackAccounts = getTrackAccounts();
  if (trackAccounts.length > 0) {
    console.log(`    📋 追跡アカウント: ${trackAccounts.join(', ')}`);
    for (const username of trackAccounts) {
      try {
        const tweets = await fetchUserTimelineByUsername(username, 30);
        const scored = tweets
          .map((t) => ({ ...t, tweetId: t.id, score: calcScore(t) }));

        const added = upsertExternalPatterns(scored, `@${username}`);
        console.log(`    @${username} → ${tweets.length} 件取得 / ${added} 件新規保存`);
        totalAdded += added;
        await sleep(2000);
      } catch (e: any) {
        console.warn(`    ⚠ @${username} 取得失敗: ${e.message}`);
      }
    }
  } else if (!searchSupported) {
    console.log('    💡 参照アカウントを追加するには TRACK_ACCOUNTS 環境変数にユーザー名をカンマ区切りで設定してください');
    console.log('    例: TRACK_ACCOUNTS=fanza_bot1,dmm_affiliate2');
  }

  console.log(`  外部パターン収集完了 (新規 ${totalAdded} 件)`);

  // 外部パターンが10件以上あればテンプレート進化を試みる
  const externalPatterns = getExternalTopPatterns(20);
  if (externalPatterns.length >= 10) {
    try {
      await evolveTemplates(externalPatterns);
    } catch (e: any) {
      console.warn(`  ⚠ テンプレート進化スキップ: ${e.message}`);
    }
  } else {
    console.log(`  📝 外部パターン不足 (${externalPatterns.length}件) → テンプレート進化スキップ`);
  }

  return totalAdded;
}

// ─── テンプレート自動進化 ────────────────────────────────────────────────────

const PLACEHOLDER_EXPLANATION = `
使えるプレースホルダー:
- {actress}      → 出演者名（例: 葵つかさ）
- {reviewCount}  → レビュー件数（例: 234）
- {reviewAvg}    → 平均評価（例: 4.8）
- {shortTitle}   → 作品タイトル（短縮版）
`.trim();

export async function evolveTemplates(externalPatterns: any[]): Promise<void> {
  const baseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const apiKey  = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  if (!baseUrl || !apiKey) {
    console.log('  ⚠ Claude API 未設定 → テンプレート進化スキップ');
    return;
  }

  const client = new Anthropic({ baseURL: baseUrl, apiKey });

  const top = externalPatterns.slice(0, 20);
  const avgScore = top.reduce((s, p) => s + p.score, 0) / Math.max(top.length, 1);

  // 絵文字・CTA・文字数などの構造特徴だけを要約（直接テキストは渡さない）
  const extractStructure = (text: string): string => {
    const hasCta = text.includes('リプ') || text.includes('→') || text.includes('👇');
    const hasNum = /\d+/.test(text);
    const charLen = text.length;
    const emojiCount = [...text].filter((c) => c.codePointAt(0)! > 0x2000).length;
    return `絵文字${emojiCount}個 CTA:${hasCta ? 'あり' : 'なし'} 数字:${hasNum ? 'あり' : 'なし'} 文字数:${charLen}`;
  };

  const structureSummary = top.slice(0, 10)
    .map((p, i) => `パターン${i + 1}(スコア${p.score}): ${extractStructure(p.text)}`)
    .join('\n');

  const prompt = `あなたはSNS販促テキストの専門家です。

以下は高エンゲージメントを獲得した投稿の構造分析データです：

${structureSummary}

このデータを参考に、動画配信サービスのアフィリエイト告知用ツイートテンプレートを6件生成してください。

${PLACEHOLDER_EXPLANATION}

生成ルール:
- 必ず 🔞 から始める
- 140文字以内（日本語）
- ハッシュタグ（#）は一切禁止
- 「リプ欄へ👇」または「リプ欄からどうぞ👇」を必ず含める
- 絵文字を2〜4個使う
- スロット種別: amateur(2件), buzz(2件), any(2件)

以下の JSON 形式のみで出力（解説文不要）:
[
  {"type": "amateur", "text": "テンプレート文字列"},
  {"type": "amateur", "text": "テンプレート文字列"},
  {"type": "buzz",    "text": "テンプレート文字列"},
  {"type": "buzz",    "text": "テンプレート文字列"},
  {"type": "any",     "text": "テンプレート文字列"},
  {"type": "any",     "text": "テンプレート文字列"}
]`;

  console.log('  🧬 外部データを元にテンプレート進化中...');

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1200,
    messages: [
      { role: 'user', content: prompt },
      { role: 'assistant', content: '[' },
    ],
  });

  const block = message.content[0];
  if (block.type !== 'text') return;

  const raw = ('[' + block.text).trim();

  let parsed: Array<{ type: string; text: string }>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // JSONが壊れている場合は部分パースを試みる
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) {
      console.warn('  ⚠ テンプレートJSONパース失敗 → スキップ');
      return;
    }
    parsed = JSON.parse(match[0]);
  }

  // バリデーション：🔞 含む・{actress}等のプレースホルダー含む・短すぎない
  const valid = parsed.filter((t) =>
    typeof t.text === 'string' &&
    t.text.includes('🔞') &&
    t.text.length >= 20 &&
    t.text.length <= 280 &&
    !t.text.includes('#') &&
    (t.text.includes('{actress}') || t.text.includes('{reviewCount}') || t.text.includes('{shortTitle}')),
  );

  if (valid.length === 0) {
    console.warn('  ⚠ 有効なテンプレートが生成されませんでした');
    return;
  }

  const toSave = valid.map((t) => ({
    text: t.text,
    type: t.type,
    sourceScore: Math.round(avgScore),
    generatedAt: new Date().toISOString(),
  }));

  upsertDynamicTemplates(toSave);
  console.log(`  ✅ テンプレート進化完了: ${valid.length}件 保存 (元データ平均スコア: ${Math.round(avgScore)})`);
  await contact.templateEvolved(valid.length, Math.round(avgScore));
}
