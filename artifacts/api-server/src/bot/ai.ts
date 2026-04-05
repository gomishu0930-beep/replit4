import Anthropic from '@anthropic-ai/sdk';
import { getDynamicTemplates, recordDynamicTemplateUsed } from './storage.js';

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

// ─── インプ狙い投稿テンプレート（アフィリリンクなし）────────────────────────
//
// 有益6：共感2：宣伝2 の比率のため、
// アフィリリンクなしの「有益・共感」投稿を1日2本追加する。
// 内容は 比較/あるある/注意喚起/ランキング/Q&A の5型をローテーション。

const IMPRESSION_TEMPLATES: string[] = [
  // 比較型
  '🔞正直に比較した結論を言う\n\n素人系 vs 人気女優系、どちらが刺さるかは\nその日の気分次第だと気づいた\n\nあなたはどちら派ですか？\n👇コメントで教えて',

  '🔞FANZAで迷ったときの選び方\n\n① レビュー数が多い → 安定択\n② 評価が高い → 当たり外れあり\n③ 新作 → ギャンブル\n\nどのタイプ派ですか？',

  // あるある・共感型
  '🔞深夜に「これだけ」と思って見始めて\n気づいたら夜が明けてる現象、\n名前つけたほうがいいと思う\n\n経験ある人いますか？👇',

  '🔞FANZA使ってて気づいたこと\n\nレビュー数100件超えてる作品は\nほぼ外れない\n\n逆に星5でも2〜3件のやつは\nギャンブルすぎる\n\n同意する人いる？🔥',

  '🔞「なんとなく再生」から「これ神作品じゃん」\nになる瞬間、好きすぎる\n\nそういう作品に出会うコツって\nランキングを信じることだと最近思ってる',

  // 注意喚起・失敗回避型
  '🔞FANZA初心者が損しがちな3つのこと\n\n① 評価だけ見てレビュー数を見ない\n② 新作だけ追う\n③ 同じ女優ばかりになる\n\nどれか心当たりありますか？👇',

  '🔞「安いから買った」FANZA作品で\n後悔したことある人、正直に挙手して\n\n価格より大事なのは\nやっぱりレビュー数だと思う',

  // ランキング・まとめ型
  '🔞個人的に「鉄板ジャンル」ランキング\n\n🥇 素人系（リアル感が好き）\n🥈 人妻系（背徳感がやばい）\n🥉 ギャル系（元気もらえる）\n\nあなたの1位は？👇',

  '🔞FANZAで「ハマった」ジャンル変遷\n\n最初：ランキング上位しか見ない\n→ 慣れてくる：素人系を掘り始める\n→ 今：レビュー数と評価の両方を見る\n\n同じ道を歩んでる人いる？',

  // Q&A型
  '🔞質問です\n\nFANZAを使うとき、あなたは\n\nA：ランキングから選ぶ\nB：女優で選ぶ\nC：ジャンルで選ぶ\nD：レビューを読んで選ぶ\n\nどれですか？👇',

  '🔞正直に教えてほしいんですが\n\n1本あたりの視聴時間って\nどのくらいですか？\n\n最後まで見派？\nとりあえず確認派？\n👇コメントで',
];

export function generateImpressionTweet(): string {
  return IMPRESSION_TEMPLATES[Math.floor(Math.random() * IMPRESSION_TEMPLATES.length)];
}

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

  // 動的テンプレートが存在する場合は 70% の確率で優先使用
  const dynPool = getDynamicTemplates(type, 5);
  if (dynPool.length > 0 && Math.random() < 0.7) {
    const chosen = dynPool[Math.floor(Math.random() * dynPool.length)];
    const text = fillTemplate(chosen.text, vars);
    recordDynamicTemplateUsed(chosen.text);
    console.log('  🧬 動的テンプレート使用');
    return text;
  }

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

  // 投稿毎に5型をランダム選択（同型文の連投を防ぐ）
  const contentTypes = [
    { name: 'レビュー型', hook: '「正直に言う」「実際に確かめた」「結論を言う」系のフック', style: '個人の感想・体験談として書く。「〜だった」「〜がわかった」の過去形が効果的。' },
    { name: '比較型', hook: '「〜よりも」「〜より断然」「比較した結果」系のフック', style: '何かと比較して優位性を示す。「他と違う点」を1つ具体的に挙げる。' },
    { name: 'ランキング型', hook: '「今一番」「個人的1位」「ぶっちぎり」系のフック', style: '順位・序列で表現する。「なぜこれが1位か」の理由を1行で添える。' },
    { name: '失敗回避型', hook: '「知らないと損」「見逃すと後悔」「注意して」系のフック', style: '「このまま知らずにいると〜」という危機感から入り、解決策として作品を提示。' },
    { name: '共感型', hook: '「あるある」「これわかる人いる？」「正直に言う」系のフック', style: 'ユーザーが共感する状況・感情から始め、自然に作品につなげる。問いかけで終わると反応率UP。' },
  ];
  const selectedType = contentTypes[Math.floor(Math.random() * contentTypes.length)];

  const prompt = `あなたは日本のSNSバイラルコンテンツの専門家です。動画配信サービスの紹介ツイートを1件作成してください。

作品情報:
- タイトル: ${title}
- 出演者: ${actress}
- カテゴリ: ${typeLabel}
- レビュー数: ${reviewCount}件
- 平均評価: ${reviewAvg}点
${ownSection}${extSection}
【今回の投稿タイプ：${selectedType.name}】
フック例: ${selectedType.hook}
文体: ${selectedType.style}

【バズるための絶対ルール】
① 1行目：スクロールを止めるフック（${selectedType.name}らしいもの）
② 2〜3行目：具体的な情報（出演者・タイトル）
③ 4行目：レビュー数・評価点などの数字（信頼性・根拠）
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
