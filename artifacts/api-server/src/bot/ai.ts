import Anthropic from '@anthropic-ai/sdk';

// ─── フック型テンプレート（止める1行目 → 情報 → 数字 → CTA）────────────────

const TEMPLATES: Record<string, string[]> = {
  amateur: [
    '🔞「これ知らないと損」\n素人なのにこのクオリティ、反則すぎる\n{actress}「{shortTitle}」\n\nレビュー{reviewCount}件・{reviewAvg}点の本物💓\nリンクはリプ欄へ👇\n#FANZA #fanza #素人',
    '🔞やばすぎて頭から離れない\n{actress}のリアルな反応が最高すぎる件\n「{shortTitle}」\n\n⭐{reviewAvg}点({reviewCount}件)の高評価が全てを語る🔥\nリプ欄チェック必須👇\n#FANZA #fanza #素人',
    '🔞正直に言う、今一番刺さってる\n素人系の中でも別格の一本がこれ👇\n{actress}「{shortTitle}」\n\nレビュー平均{reviewAvg}点の本物の実力🏆\n#FANZA #fanza #素人',
    '🔞素人なのになんでこんなにうまいの\n{actress}ちゃんの「{shortTitle}」\n\nレビュー{reviewCount}件・{reviewAvg}点の怪物作品💥\n今すぐリプ欄でチェック👇\n#FANZA #fanza #素人',
  ],
  rank: [
    '🔞「今これが一番売れてる」\nランキング上位を独走中の神作品👑\n{actress}「{shortTitle}」\n\nレビュー{reviewCount}件・{reviewAvg}点が証明する実力\nリンクはリプ欄へ👇\n#FANZA #fanza #{genreTag}',
    '🔞見た人全員が言う→やばすぎ\n{actress}のランキング1位作品がこれ💥\n「{shortTitle}」\n\n⭐{reviewAvg}点({reviewCount}件)の化け物評価\nリプ欄からどうぞ👇\n#FANZA #fanza #{genreTag}',
    '🔞ランキング上位が伊達じゃない理由\n{actress}「{shortTitle}」\n\n結論：クオリティが全然違う\n理由：レビュー{reviewCount}件・{reviewAvg}点\nリプ欄でチェック👇\n#FANZA #fanza #{genreTag}',
    '🔞これ知らないと損します\n{actress}主演がランキングを席巻中🔥\n「{shortTitle}」\n\nレビュー{reviewAvg}点({reviewCount}件)の本物\nリンクはリプ欄へ👇\n#FANZA #fanza #{genreTag}',
  ],
  sale: [
    '🔞「今だけ」を見逃すと後悔する件\n{actress}「{shortTitle}」がセール中💸\n\n⭐{reviewAvg}点({reviewCount}件)の神作品が期間限定\n今しかない→リプ欄へ👇\n#FANZA #fanza #セール #{genreTag}',
    '🔞正直言う、これ安すぎる\n{actress}のセール作品がヤバい💰\n「{shortTitle}」\n\nレビュー{reviewCount}件・{reviewAvg}点の高評価\n終わる前に→リプ欄チェック👇\n#FANZA #fanza #セール #{genreTag}',
    '🔞セールで一番コスパいい作品はこれ\n{actress}「{shortTitle}」\n\n結論：{reviewAvg}点が全てを語ってる✅\nレビュー{reviewCount}件の本物\n期間限定→リプ欄へ👇\n#FANZA #fanza #お得 #{genreTag}',
  ],
  buzz: [
    '🔞「なんで今まで見てなかったんだ」\nレビュー{reviewCount}件が絶賛する理由がわかった\n{actress}「{shortTitle}」\n\n⭐{reviewAvg}点の化け物評価💥\nリプ欄からどうぞ👇\n#FANZA #fanza #{genreTag}',
    '🔞バズってる理由を確かめた結果\n{actress}「{shortTitle}」は本物だった🔥\n\nレビュー{reviewCount}件・平均{reviewAvg}点\nこれが今一番アツい作品👑\nリプ欄へ👇\n#FANZA #fanza #{genreTag}',
    '🔞口コミが止まらない神作品\n{actress}「{shortTitle}」\n\n結論：レビュー{reviewCount}件は伊達じゃない💬\n平均{reviewAvg}点の実力\n詳細→リプ欄へ👇\n#FANZA #fanza #{genreTag}',
  ],
  random: [
    '🔞まだ知らない人に教えたい隠れた名作\n{actress}「{shortTitle}」\n\n⭐{reviewAvg}点({reviewCount}件)なのに埋もれてる💎\nリプ欄からチェック👇\n#FANZA #fanza #{genreTag}',
    '🔞正直これが一番好みに刺さった\n{actress}「{shortTitle}」\n\nレビュー{reviewCount}件・{reviewAvg}点の実力派🎯\nリンクはリプ欄へ👇\n#FANZA #fanza #{genreTag}',
    '🔞知らないと絶対損するやつ\n{actress}の「{shortTitle}」\n\n平均{reviewAvg}点が物語る本物のクオリティ🌟\nリプ欄でどうぞ👇\n#FANZA #fanza #{genreTag}',
  ],
};

const DEFAULT_TEMPLATES = [
  '🔞これ知らないと損です\n{actress}「{shortTitle}」\n\nレビュー{reviewCount}件・平均{reviewAvg}点の高評価作品🔥\nリンクはリプ欄へ👇\n#FANZA #fanza #{genreTag}',
];

// ─── エンゲージメント誘導リプライ（3投目）────────────────────────────────

const ENGAGEMENT_REPLIES: Record<string, string[]> = {
  amateur: [
    '💬 あなたはどんなタイプの素人が好みですか？\nコメントで教えてください👇',
    '🗳️ 素人系で好みはどっち？\n👉 天然系 or 積極系\nどちらか教えて！',
    '💭 このジャンル好きな方→🔥いいね！\n嫌いな方→💬コメントで教えて',
  ],
  rank: [
    '💬 ランキング上位作品、あなたはもう見ましたか？\nコメントで感想教えてください👇',
    '🗳️ 好みはどっち？\n👉 ランキング上位 or 隠れた名作\nコメントで！',
    '💭 顔派？スタイル派？どっちが好きですか？\nコメントで教えてください👇',
  ],
  sale: [
    '💬 セール中に買うか、定価で買うか迷う派ですか？\nコメントで教えてください👇',
    '🗳️ セールで一番重視するのは？\n👉 値段 or クオリティ\nどちらか教えて！',
    '💭 お得な情報は保存しておきたい派ですか？\nいいね🤍で教えてください！',
  ],
  buzz: [
    '💬 話題作と隠れた名作、どちら派ですか？\nコメントで教えてください👇',
    '🗳️ 好みはどっち？\n👉 バズってる作品 or 通好みの作品\nコメントで！',
    '💭 レビュー数が多い作品、信頼できると思う？\nいいね🤍orコメントで👇',
  ],
  random: [
    '💬 今一番気になるジャンルは何ですか？\nコメントで教えてください👇',
    '🗳️ 好みはどっち？\n👉 人気女優 or 新人女優\nコメントで！',
    '💭 知られていない名作、好きですか？\nいいね🤍で教えてください！',
  ],
};

const DEFAULT_ENGAGEMENT = [
  '💬 気になるジャンルや女優さんはいますか？\nコメントで教えてください👇',
  '🗳️ 好みはどっち？\n👉 王道系 or 個性派\nコメントで！',
];

export function generateEngagementReply(type: string): string {
  const pool = ENGAGEMENT_REPLIES[type] || DEFAULT_ENGAGEMENT;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── ジャンルタグ・ユーティリティ────────────────────────────────────────────

const GENRE_TAGS: Record<string, string> = {
  '巨乳': '巨乳', '美乳': '美乳', '単体作品': '単体作品', '美少女': '美少女',
  'ハイビジョン': 'HiVi', 'OL': 'OL', '人妻': '人妻', 'ギャル': 'ギャル',
  'ロリ': 'ロリ', 'アイドル': 'アイドル', '素人': '素人', 'ナンパ': 'ナンパ',
  'フェラ': 'フェラ', '中出し': '中出し', '痴漢': '痴漢', 'レズ': 'レズ', 'SM': 'SM',
};

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getGenreTag(item: any): string {
  const genres: string[] = item.genre?.map((g: any) => g.name) || [];
  for (const g of genres) {
    if (GENRE_TAGS[g]) return GENRE_TAGS[g];
  }
  return 'アダルト';
}

function shortTitle(title: string, maxLen = 25): string {
  return title.length > maxLen ? title.slice(0, maxLen) + '…' : title;
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (t, [k, v]) => t.replace(new RegExp(`{${k}}`, 'g'), v),
    template,
  );
}

function buildTemplateText(item: any, type: string): string {
  const vars = {
    actress: item.actress?.map((a: any) => a.name).join('・') || '人気女優',
    reviewCount: String(item.review?.count ?? 0),
    reviewAvg: String(item.review?.average ?? '4.5'),
    genreTag: getGenreTag(item),
    shortTitle: shortTitle(item.title),
    rank: String(Math.floor(Math.random() * 10) + 1),
  };
  const pool = TEMPLATES[type] || DEFAULT_TEMPLATES;
  return fillTemplate(pickRandom(pool), vars);
}

function buildTypeLabel(type: string): string {
  const map: Record<string, string> = {
    amateur: '素人系・リアル感のある作品',
    rank: 'ランキング上位作品',
    sale: 'セール品・お得な作品',
    buzz: '話題沸騰・高評価作品',
    random: '注目・おすすめ作品',
  };
  return map[type] ?? '注目作品';
}

// ─── 拒否文検出・バリデーション────────────────────────────────────────────

const REFUSAL_PATTERNS = [
  'できません', '申し訳', 'お断り', 'ご連絡いただきありがとう',
  'unable to', 'i cannot', "i'm unable", 'i am unable', 'not able to',
  'nsfw', 'adult content', 'promotional content for', 'affiliate marketing',
  'i apologize', 'unfortunately', 'cannot assist', 'cannot create',
  'cannot help', 'content policy', 'お手伝いいたします',
];

function isRefusal(text: string): boolean {
  const lower = text.toLowerCase();
  return REFUSAL_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

function isValidTweet(text: string): boolean {
  return text.includes('🔞') && text.includes('#FANZA');
}

// ─── Claude 生成────────────────────────────────────────────────────────────

async function generateWithClaude(
  item: any, type: string, topPatterns: any[], externalPatterns: any[] = [],
): Promise<string | null> {
  const baseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  if (!baseUrl || !apiKey) return null;

  const client = new Anthropic({ baseURL: baseUrl, apiKey });

  const actress = item.actress?.map((a: any) => a.name).join('・') || '人気女優';
  const reviewCount = item.review?.count ?? 0;
  const reviewAvg = item.review?.average ?? '4.5';
  const genreTag = getGenreTag(item);
  const title = shortTitle(item.title, 30);
  const typeLabel = buildTypeLabel(type);

  const ownExamples = topPatterns.slice(0, 2);
  const extExamples = externalPatterns.slice(0, 2);

  const ownSection = ownExamples.length > 0
    ? `\n【自分の過去高エンゲージメント投稿（スタイル参考）】:\n${ownExamples.map((p, i) => `例${i + 1}: ${p.text}`).join('\n\n')}\n`
    : '';

  const extSection = extExamples.length > 0
    ? `\n【他アカウントの高エンゲージメント投稿（スタイル参考のみ）】:\n${extExamples.map((p, i) => `参考${i + 1}: ${p.text}`).join('\n\n')}\n`
    : '';

  const prompt = `あなたは日本のSNSバイラルコンテンツの専門家です。動画配信サービスのアフィリエイト紹介ツイートを1件作成してください。

作品情報:
- タイトル: ${title}
- 出演者: ${actress}
- カテゴリ: ${typeLabel}
- レビュー数: ${reviewCount}件
- 平均評価: ${reviewAvg}点
- ジャンルタグ: #${genreTag}
${ownSection}${extSection}
【バズる投稿の構成（必ず守る）】
① 1行目：スクロールを止めるフック（「〇〇知らないと損」「やばすぎ」「正直言う」「なんでこんなに」系）
② 2行目：出演者と作品名
③ 3行目：レビュー数・評価点などの具体的な数字（信頼性）
④ 4行目：「リプ欄へ👇」のCTA

出力ルール（厳守）:
- 必ず 🔞 から始める（1文字目）
- 日本語140文字以内
- 末尾に必ず #FANZA #fanza #${genreTag} を付ける
- 「リプ欄へ👇」「リプ欄からどうぞ👇」のどちらかを含める
- 絵文字を2〜4個使う

ツイート本文だけを出力してください:`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 350,
    messages: [
      { role: 'user', content: prompt },
      { role: 'assistant', content: '🔞' },
    ],
  });

  const block = message.content[0];
  if (block.type !== 'text') return null;
  const text = ('🔞' + block.text).trim();

  if (text.length < 10 || text.length > 450) return null;
  if (isRefusal(text)) {
    console.warn('  ⚠ Claude が拒否応答を返したためテンプレートで代替');
    return null;
  }
  if (!isValidTweet(text)) {
    console.warn('  ⚠ Claude 応答が必須要素を欠くためテンプレートで代替');
    return null;
  }
  return text;
}

// ─── メインエクスポート────────────────────────────────────────────────────

export async function generateTweetText(
  item: any,
  type: string,
  topPatterns: any[] = [],
  externalPatterns: any[] = [],
): Promise<string> {
  try {
    const aiText = await generateWithClaude(item, type, topPatterns, externalPatterns);
    if (aiText) {
      console.log('  ✨ Claude で文章生成成功');
      return aiText;
    }
  } catch (e: any) {
    console.warn(`  ⚠ Claude 生成失敗、テンプレートで代替: ${e.message}`);
  }

  console.log('  📝 テンプレートで文章生成');
  return buildTemplateText(item, type);
}
