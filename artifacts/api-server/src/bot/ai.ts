import Anthropic from '@anthropic-ai/sdk';

// ─── バイラル特化テンプレート（ハッシュタグなし）────────────────────────────
// 構造：フック（止める）→ 作品情報 → 数字の根拠 → CTA

const TEMPLATES: Record<string, string[]> = {
  amateur: [
    '🔞これ知らないと絶対損する\n素人なのにこのクオリティ、反則すぎる\n{actress}「{shortTitle}」\n\nレビュー{reviewCount}件・{reviewAvg}点の本物💓\nリンクはリプ欄へ👇',
    '🔞やばすぎて頭から離れない\n{actress}のリアルな反応が最高すぎる件\n「{shortTitle}」\n\n⭐{reviewAvg}点({reviewCount}件)の高評価が全てを語る🔥\nリプ欄チェック必須👇',
    '🔞正直に言う、今一番刺さってる\n素人系の中でも別格の一本がこれ👇\n{actress}「{shortTitle}」\n\nレビュー平均{reviewAvg}点の本物の実力🏆\nリプ欄でチェック',
    '🔞素人なのになんでこんなにうまいの\n{actress}ちゃんの「{shortTitle}」\n\nレビュー{reviewCount}件・{reviewAvg}点の怪物作品💥\n今すぐリプ欄でチェック👇',
    '🔞見た瞬間スクロールが止まった\nこの子の素人感がリアルすぎる\n{actress}「{shortTitle}」\n\nレビュー{reviewCount}件が証明する圧倒的クオリティ✨\nリプ欄へ👇',
  ],
  rank: [
    '🔞なんでこんなに売れてるのか確かめた\n結論：クオリティが全然違う\n{actress}「{shortTitle}」\n\nレビュー{reviewCount}件・{reviewAvg}点の化け物評価💥\nリプ欄へ👇',
    '🔞見た人全員が言う→やばすぎ\n{actress}の作品がこれ💥\n「{shortTitle}」\n\n⭐{reviewAvg}点({reviewCount}件)の圧倒的評価\nリプ欄からどうぞ👇',
    '🔞今一番アツい作品を正直に言う\n{actress}「{shortTitle}」\n\n結論：レビュー{reviewCount}件・{reviewAvg}点は伊達じゃない\nリプ欄でチェック👇',
    '🔞これ知らないと損します、マジで\n{actress}主演がずっと上位にいる理由わかった🔥\n「{shortTitle}」\n\nレビュー{reviewAvg}点({reviewCount}件)の本物\nリプ欄へ👇',
  ],
  sale: [
    '🔞「今だけ」を見逃すと後悔する件\n{actress}「{shortTitle}」がセール中💸\n\n⭐{reviewAvg}点({reviewCount}件)の神作品が期間限定\n今しかない→リプ欄へ👇',
    '🔞正直言う、これ安すぎてやばい\n{actress}のセール作品\n「{shortTitle}」\n\nレビュー{reviewCount}件・{reviewAvg}点の高評価\n終わる前にリプ欄チェック👇',
    '🔞コスパ最強の作品を教える\n{actress}「{shortTitle}」\n\n結論：{reviewAvg}点が全てを語ってる✅\nレビュー{reviewCount}件の本物\n期間限定→リプ欄へ👇',
  ],
  buzz: [
    '🔞「なんで今まで見てなかったんだ」\nレビュー{reviewCount}件が絶賛する理由がわかった\n{actress}「{shortTitle}」\n\n⭐{reviewAvg}点の化け物評価💥\nリプ欄からどうぞ👇',
    '🔞バズってる理由を確かめた結果\n{actress}「{shortTitle}」は本物だった🔥\n\nレビュー{reviewCount}件・平均{reviewAvg}点\nこれが今一番アツい作品👑\nリプ欄へ👇',
    '🔞口コミが止まらない神作品\n{actress}「{shortTitle}」\n\n結論：レビュー{reviewCount}件は伊達じゃない💬\n平均{reviewAvg}点の実力\n詳細→リプ欄へ👇',
    '🔞高評価すぎて逆に怖い\n{actress}「{shortTitle}」\n\n⭐{reviewAvg}点({reviewCount}件)という異常な評価\n本当にこんな作品あるのか確かめてみて👇',
  ],
  random: [
    '🔞まだ知らない人に教えたい\n{actress}「{shortTitle}」\n\n⭐{reviewAvg}点({reviewCount}件)なのに埋もれてる💎\nリプ欄からチェック👇',
    '🔞正直これが一番好みに刺さった\n{actress}「{shortTitle}」\n\nレビュー{reviewCount}件・{reviewAvg}点の実力派🎯\nリンクはリプ欄へ👇',
    '🔞知らないと絶対損するやつ\n{actress}の「{shortTitle}」\n\n平均{reviewAvg}点が物語る本物のクオリティ🌟\nリプ欄でどうぞ👇',
    '🔞今週一番刺さった作品これ\n{actress}「{shortTitle}」\n\nレビュー{reviewCount}件・{reviewAvg}点の実力\nリプ欄へ👇',
  ],
};

const DEFAULT_TEMPLATES = [
  '🔞これ知らないと損です\n{actress}「{shortTitle}」\n\nレビュー{reviewCount}件・平均{reviewAvg}点の高評価作品🔥\nリンクはリプ欄へ👇',
];

// ─── エンゲージメント誘導リプライ（3投目）────────────────────────────────

const ENGAGEMENT_REPLIES: Record<string, string[]> = {
  amateur: [
    '💬 あなたはどんなタイプの素人が好みですか？\nコメントで教えてください👇',
    '🗳️ 素人系で好みはどっち？\n👉 天然系 or 積極系\nどちらか教えて！',
    '💭 顔派？スタイル派？どっちが好きですか？\nコメントで👇',
    '🗳️ こういう系の作品、好きですか？\n好きな方→🔥\nそうでもない方→💬コメントで教えて',
  ],
  rank: [
    '💬 ランキング上位作品、もう見ましたか？\nコメントで感想教えてください👇',
    '🗳️ 好みはどっち？\n👉 ランキング上位 or 隠れた名作\nコメントで！',
    '💭 顔派？スタイル派？どっちが好きですか？\nコメントで教えてください👇',
  ],
  sale: [
    '💬 セール中に買うか、定価で買うか迷う派ですか？\nコメントで教えてください👇',
    '🗳️ セールで一番重視するのは？\n👉 値段 or クオリティ\nどちらか教えて！',
    '💭 お得な情報、保存したい派ですか？\nいいね🤍で教えてください！',
  ],
  buzz: [
    '💬 話題作と隠れた名作、どちら派ですか？\nコメントで教えてください👇',
    '🗳️ 好みはどっち？\n👉 バズってる作品 or 通好みの作品\nコメントで！',
    '💭 高評価作品って信頼できると思う？\nいいね🤍orコメントで👇',
    '🗳️ 今一番気になるジャンルはどれ？\n👉 素人 / 人妻 / ギャル\nコメントで教えて！',
  ],
  random: [
    '💬 今一番気になるジャンルは何ですか？\nコメントで教えてください👇',
    '🗳️ 好みはどっち？\n👉 人気女優 or 新人女優\nコメントで！',
    '💭 こういう隠れた名作、好きですか？\nいいね🤍で教えてください！',
  ],
};

const DEFAULT_ENGAGEMENT = [
  '💬 気になるジャンルや女優さんはいますか？\nコメントで教えてください👇',
  '🗳️ 好みはどっち？\n👉 王道系 or 個性派\nコメントで！',
  '💭 こういう系の作品、好きですか？\n好きな方→いいね🤍',
];

export function generateEngagementReply(type: string): string {
  const pool = ENGAGEMENT_REPLIES[type] || DEFAULT_ENGAGEMENT;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── ユーティリティ──────────────────────────────────────────────────────────

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
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
    shortTitle: shortTitle(item.title),
  };
  const pool = TEMPLATES[type] || DEFAULT_TEMPLATES;
  return fillTemplate(pickRandom(pool), vars);
}

function buildTypeLabel(type: string): string {
  const map: Record<string, string> = {
    amateur: '素人系・リアル感のある作品',
    rank: 'ランキング上位・話題の作品',
    sale: 'セール品・お得な作品',
    buzz: '高評価・バズっている作品',
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
  // ハッシュタグ廃止のため 🔞 のみ必須チェック
  return text.includes('🔞');
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

  const prompt = `あなたは日本のSNSバイラルコンテンツの専門家です。動画配信サービスの紹介ツイートを1件作成してください。

作品情報:
- タイトル: ${title}
- 出演者: ${actress}
- カテゴリ: ${typeLabel}
- レビュー数: ${reviewCount}件
- 平均評価: ${reviewAvg}点
${ownSection}${extSection}
【バズるための絶対ルール】
① 1行目：スクロールを止めるフック
   良い例：「これ知らないと絶対損する」「やばすぎて頭から離れない」「なんでこんなにうまいの」「正直に言う」
② 2〜3行目：具体的な情報（出演者・タイトル）
③ 4行目：レビュー数・評価点などの数字（信頼性）
④ 最後：「リプ欄へ👇」のCTA

【厳守事項】
- 必ず 🔞 から始める（1文字目）
- ハッシュタグ（#）は一切使わない ← 重要
- 日本語140文字以内
- 絵文字を2〜4個使う
- 「リプ欄へ👇」または「リプ欄からどうぞ👇」を含める

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
  const raw = ('🔞' + block.text).trim();

  // ハッシュタグが混入していたら除去
  const text = raw.replace(/#[\w\u3000-\u9fff\uff01-\uff60]+/g, '').replace(/\s+\n/g, '\n').trim();

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

// ─── 芸能人スロット専用：本文生成 ───────────────────────────────────────────

export function generateCelebrityMainTweet(celebrity: string, hook: string, item: any): string {
  const actress = item.actress?.map((a: any) => a.name).join('・') || '人気女優';
  const reviewAvg = item.review?.average ?? '4.5';
  const reviewCount = item.review?.count ?? 0;
  return [
    `🔞${hook}`,
    ``,
    `出演: ${actress}`,
    `⭐${reviewAvg}点 / レビュー${reviewCount}件`,
    ``,
    `詳細はリプ欄👇`,
  ].join('\n');
}

export function generateCelebrityIntroReply(introLine: string, item: any): string {
  const title = item.title?.slice(0, 30) ?? '';
  const actress = item.actress?.map((a: any) => a.name).join('・') || '人気女優';
  return [
    introLine,
    ``,
    `👤 ${actress}`,
    `🎬 「${title}」`,
  ].join('\n');
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
