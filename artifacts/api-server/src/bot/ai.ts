import Anthropic from '@anthropic-ai/sdk';
import { getDynamicTemplates, recordDynamicTemplateUsed, getPostsAfter, getTopPatterns, getLatestAlgoInsight } from './storage.js';
import { getXActiveDirectives } from './meeting.js';
import { getOwnRecentTweets } from './twitter.js';

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
    '🔞こういう作品がセールになるのか、という驚き\n⭐{reviewAvg}点・レビュー{reviewCount}件の高評価作品が期間限定\n\nAV女優名：{actress}\n詳細はリプ欄へ👇',
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

// ② テンプレート刷新：FANZAに言及しない「恋愛・感情・共感」系テーマに変更
// → 一般ユーザーも反応しやすい → シャドウバン解除中のアカウント信頼回復に効果的

// ─── [Grok分析 2026/4 追加] 競合ベンチマーク知見 ─────────────────────────────
// 分析対象: @marcoapmontiel(840万インプ/935フォロワー), @DanaLawren75587, @CHubrig48481
// 転用パターン:
//   感情爆発型: 「ぶっ刺さった！！めちゃいいぞ！！」12文字前後・感嘆符3連
//   日常ｗｗ型: 「リプみたらバグったｗｗ」好奇心誘発・リプ促進
//   FOMO型: 「今年一番」「脳破壊級」「止まらん」でRT率+26%
//   深夜2-4時投稿でインプ+50%（Grokデータ確認済み）

const IMPRESSION_TEMPLATES: string[] = [
  // 感情爆発型（@marcoapmontiel 840万インプパターン採用）
  '今年一番ぶっ刺さった😭\n\nこれ見たらわかる\n刺さりすぎて震えた\n\nわかる人→❤️\nRT→🔁',

  '脳が溶けるやつ見つけた\n\nマジで止まらなくなるから\n覚悟して見てほしい\n\n見た人→❤️教えて👇',

  '深夜に見るやつじゃなかった😂\n\nなんでこんなにハマるんだ\n気づいたら2時間経ってた\n\n同じ経験した人いる？👇',

  // 日常ｗｗ型（@CHubrig48481 パターン採用）
  'リプみたら止まらなくなったｗｗ\n\nなんなんこれ、やばすぎ\n共感できる人いたら教えて\n\n共感→❤️ あるある→🔁',

  'こんな展開あるかｗｗｗ\n\n深夜に見たら絶対やばいやつ\n覚悟できた人だけ👇\n\nどうする？コメントで教えて',

  '出張に連れてきたらあかんやつｗ\n\n正直、困ってる😂\nわかる人いますか？\n\nわかる→❤️ うらやまｗ→🔁',

  // 感情・共感型（既存）
  '🔞聞いていいですか\n\n好きな人に「好きだよ」って\n言ってほしいですか？\nそれとも\n行動で示してほしいですか？\n\n言葉派→❤️\n行動派→🔁',

  '🔞深夜に刺さる話\n\n「好きな人の名前って\n　無意識に探してしまう」\n\nこれ、わかる人いますか？\n👇コメントで教えて',

  '🔞あるある\n\n深夜になると\nなぜか急に人恋しくなる\n\nこれ、私だけじゃないですよね？\n👇共感したら教えて',

  '🔞これわかる人いますか\n\n好きな人のことを考えてたら\n気づいたら1時間経ってた\n\nわかる→❤️\nわからない→🔁',

  '🔞正直に教えてほしいんですが\n\n恋愛してるとき\n「嫌われたらどうしよう」って\n毎回不安になりますか？\n\nなる→❤️\nならない→🔁',

  // 比較・選択型（一般テーマ）
  '🔞これどちらが好みですか\n\n・積極的に来てくれる人\n・少し引いてる人\n\nどちらに惹かれますか？\n👇コメントで',

  '🔞質問です\n\n理想のパートナーは\nA：外見重視\nB：内面重視\nC：一緒にいて楽な人\nD：刺激をくれる人\n\nどれですか？👇',

  '🔞深夜に考えたこと\n\n「一番幸せな瞬間」って\n何かと聞かれたら\nなんて答えますか？\n\n👇コメントで教えて',

  // あるある型（一般）
  '🔞これ共感する人いますか\n\n夜中の3時に急に\n「自分、何やってるんだろう」\nってなる現象\n\nある→❤️\nない→🔁',

  '🔞正直に言います\n\n好きな人が他の誰かと\n楽しそうにしてるのを見ると\n胸がざわつく\n\nこれ、わかる人いますか？',
];

// ─── グローバルリーチ A/Bテスト（W2〜）────────────────────────────────────
// X自動翻訳（Grok）により日本語ポストが海外TLに推薦表示される機能を活用。
// バリアントB: インプ投稿末尾に英語タグを追加し、海外いいね→アカウント評価UPを狙う。
// バリアントA: 従来通りの純日本語（コントロール）
//
// 使用タグ選定理由:
//   #LateNightThoughts … 深夜共感系の投稿と相性◎ / 海外でエンゲージ率が高いタグ
//   #Japanese          … Japaneseコンテンツファンへのリーチ
//   #Love              … 恋愛・感情系テンプレートの内容と一致

const GLOBAL_REACH_TAG_SETS: string[] = [
  '#LateNightThoughts #Japanese #Love',
  '#LateNight #Japanese #Relatable',
  '#NightThoughts #Japanese #Love',
  '#Feelings #Japanese #LateNightThoughts',
];

// ─── 猥談投稿テンプレート（生成画像付き）────────────────────────────────────
// 実体験風・場面描写・夜話形式。Pony V6生成画像と組み合わせる。
// imagePrompt は buildPonyV6Prompt() に渡す英語プロンプトのヒント。

const EROTIC_STORY_TEMPLATES: Array<{ text: string; imagePrompt: string }> = [
  {
    text: '🔞昨夜の出来事、聞いてもらっていいですか\n\n残業で2人きりになった瞬間\n彼女から急に「ずっと気になってた」って\n\n気づいたら引き留める腕が震えてた\n\n続きが知りたい人は❤️',
    imagePrompt: 'office lady, white dress shirt, late night office, window reflections, dim light, leaning close, blushing',
  },
  {
    text: '🔞これ、リアルな話なんですが\n\n銭湯帰りの彼女が\n「まだ火照ってる」って言いながら\n浴衣の帯をほどいてきた\n\n頭の中が真っ白になった瞬間のこと\n今でも覚えてる',
    imagePrompt: 'japanese woman, yukata slipping off shoulder, steamy room, soft lighting, wet hair, flushed cheeks',
  },
  {
    text: '🔞正直に言います\n\n隣の席のOLさんが\nこちらを見て微笑むたびに\nどうにかなりそうになる\n\n昨日のランチ、2人きりで行った\nその後のことは……深夜になったら話します',
    imagePrompt: 'office lady, pencil skirt, lunch break, close conversation, subtle smile, leaning forward, soft bokeh',
  },
  {
    text: '🔞夜中に送られてきたLINE\n\n「今、何してる？」\n\nって彼女から来た瞬間\n心臓が跳ねた\n\n返信した内容と\nその後何があったか\nコメントで教えてほしいって言ったら怒りますか？',
    imagePrompt: 'young woman lying on bed, phone screen glow, night room, loose t-shirt, hair down, playful expression',
  },
  {
    text: '🔞こういう経験した人いますか\n\n友達の彼女と2人で飲む約束をして\nそこで初めて気づいた\n\n「この子、俺のことが好きだ」\n\n気まずくなる前の\nあの沈黙、最高だった',
    imagePrompt: 'woman sitting across table, izakaya bar, dim warm lighting, wine glass, meaningful eye contact, leaning on hand',
  },
  {
    text: '🔞これ共感する人いますか\n\n温泉旅行、部屋に戻ってきたら\n浴衣姿の彼女が\nベッドに横になって待ってた\n\n「一緒に入ればよかったのに」って\n笑いながら言うから\n理性が飛んだ',
    imagePrompt: 'japanese woman, hotel room, white yukata, lying on bed, looking over shoulder, warm lighting, soft smile',
  },
  {
    text: '🔞深夜に話します\n\n同僚の女の子に急に言われた\n「私のこと、どう思ってるの」\n\n廊下で2人きりの時\n距離が縮まるのを感じた\n\n続き読みたい人は❤️',
    imagePrompt: 'two people standing close in corridor, late night, office hallway, looking up with expectation, indoor lighting',
  },
  {
    text: '🔞ちょっと恥ずかしい話\n\n初めてのドライブデートで\n「寒い」って言ったら\n向こうから手をつないできた\n\nそのまま指を絡ませてきた時の\nドキドキを今でも思い出す',
    imagePrompt: 'night drive, car interior, woman passenger reaching for hand, dashboard glow, city lights blur, intimate',
  },
  {
    text: '🔞正直これはやばかった\n\n出張先のホテルで\n偶然同じ部屋番号を割り当てられて\n\nフロントのミスだとわかったのは\n翌朝のこと\n\nその夜何があったか\nわかりますよね？',
    imagePrompt: 'hotel corridor, woman standing in doorway, surprised expression, luggage, evening light, slight smile',
  },
  {
    text: '🔞これ夢じゃなくてリアルな話\n\n終電なくした彼女を泊めた夜\n\n「シャワー借りていい？」\nって言いながら\n着替えを持ってきてなかった\n\nその後の展開、わかる人いますか？',
    imagePrompt: 'woman wrapped in towel, bathroom door ajar, steam, shy expression, reaching out, apartment room',
  },
  {
    text: '🔞これ言っていいのかわからないけど\n\n職場の先輩女性に\n「最近、あなたのことばかり考えてる」\nって言われて固まった\n\n2人で残業してた時\n彼女から距離を縮めてきた',
    imagePrompt: 'mature office woman, late night office, leaning over desk, confident expression, close proximity, window backdrop',
  },
  {
    text: '🔞夏の話なんですが\n\n彼女がプールから上がってきた瞬間\n水が滴る体をタオルで拭いてあげてたら\n\n「ちゃんと全部拭いて」って\nこっちを見て言ってきた\n\nわかるよね、この空気感',
    imagePrompt: 'woman emerging from pool, wet swimsuit, slicked back hair, handing towel, summer day, close up smile',
  },
];

/** 猥談投稿を生成する。テキストと画像プロンプトのセットを返す */
export function generateEroticStoryTweet(): { text: string; imagePrompt: string } {
  const item = EROTIC_STORY_TEMPLATES[Math.floor(Math.random() * EROTIC_STORY_TEMPLATES.length)];
  return { text: item.text, imagePrompt: item.imagePrompt };
}

// ─────────────────────────────────────────────────────────────────────────────

/** インプ狙い投稿を生成する
 * @param globalReach true のとき英語タグ付きバリアントB（W2以降のA/Bテスト用）
 * @returns { text, variant } variant は 'A'（日本語のみ）or 'B'（英語タグ付き）
 */
export function generateImpressionTweet(globalReach = false): { text: string; variant: 'A' | 'B' } {
  const base = IMPRESSION_TEMPLATES[Math.floor(Math.random() * IMPRESSION_TEMPLATES.length)];
  if (!globalReach) return { text: base, variant: 'A' };
  const tags = GLOBAL_REACH_TAG_SETS[Math.floor(Math.random() * GLOBAL_REACH_TAG_SETS.length)];
  return { text: `${base}\n\n${tags}`, variant: 'B' };
}

// ─── 5型コンテンツトラッカー ─────────────────────────────────────────────────
// Claude生成時に選択された型名を記録し、schedulerがrecordPostに渡せるようにする

let _lastContentType = 'テンプレート型';
export function getLastContentType(): string { return _lastContentType; }

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
    actress: item.actress?.map((a: any) => a.name).join('・') || '出演女優',
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
  if (!text.includes('🔞')) return false;
  // 曖昧な芸能人類似表現が使われていたら警告（ブロックはしない）
  if (text.includes('人気女優') || text.includes('トップ女優') || text.includes('著名女優')) {
    console.warn('  ⚠ [品質] 曖昧表現「人気女優」等が検出されました → 次回は改善されます');
  }
  return true;
}

// ─── Anthropic クライアント共通 ──────────────────────────────────────────────

export function makeAnthropicClient(): Anthropic | null {
  const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  if (!baseURL || !apiKey) return null;
  return new Anthropic({ baseURL, apiKey });
}

// ─── 知見ループ：会議・アルゴ・実績 → プロンプト注入コンテキスト ─────────────

export function buildCelebrityPostContext(): string {
  const sections: string[] = [];

  // ① 過去の高パフォーマンス投稿（実績パターン）
  try {
    const top = getTopPatterns(3);
    if (top.length > 0) {
      const examples = top.map((p) => {
        const imp = p.metrics?.impression_count ?? 0;
        const eng = (p.metrics?.like_count ?? 0) + (p.metrics?.retweet_count ?? 0) * 3;
        const preview = (p.text ?? '').slice(0, 60).replace(/\n/g, ' ');
        return `  ・「${preview}…」→ インプ${imp.toLocaleString()} / エンゲ${eng}`;
      }).join('\n');
      sections.push(`## 📊 直近の高パフォーマンス投稿（参考にすべきパターン）\n${examples}`);
    }
  } catch { /* ストレージ未初期化時はスキップ */ }

  // ② アルゴ解析からの知見（最新ブリーフィング）
  try {
    const insight = getLatestAlgoInsight();
    if (insight?.briefing) {
      const brief = insight.briefing.slice(0, 300);
      sections.push(`## 🧠 アルゴ解析からの知見\n${brief}`);
    }
  } catch { /* スキップ */ }

  // ③ 会議決定事項（コンテンツ系のactiveなもの）
  try {
    const directives = getXActiveDirectives()
      .filter((d) => d.category === 'content' || d.category === 'strategy')
      .slice(0, 4);
    if (directives.length > 0) {
      const list = directives.map((d) => `  ・[${d.category}/${d.priority}] ${d.text.slice(0, 80)}`).join('\n');
      sections.push(`## 📋 会議決定事項（AI戦略チームの指示）\n${list}`);
    }
  } catch { /* スキップ */ }

  return sections.length > 0
    ? '\n\n' + sections.join('\n\n')
    : '';
}

// ─── Claude 生成────────────────────────────────────────────────────────────

export interface TweetWithImagePrompt {
  text: string;
  imagePrompt: string | null;
}

async function generateWithClaude(
  item: any, type: string, topPatterns: any[], externalPatterns: any[] = [],
  grokResearch?: string,
): Promise<TweetWithImagePrompt | null> {
  const baseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  if (!baseUrl || !apiKey) return null;

  const client = new Anthropic({ baseURL: baseUrl, apiKey });

  const actressRaw = item.actress?.map((a: any) => a.name).join('・') || '';
  const actress = actressRaw;
  const reviewCount = item.review?.count ?? 0;
  const reviewAvg = item.review?.average ?? '4.5';
  const title = shortTitle(item.title, 30);
  const fullTitle = item.title ?? title;
  const typeLabel = buildTypeLabel(type);
  const genreList: string[] = item.genre ?? [];

  const ownExamples = topPatterns.slice(0, 3);
  const extExamples = externalPatterns.slice(0, 3);

  const ownSection = ownExamples.length > 0
    ? `\n【自分の過去高エンゲージメント投稿（スタイル参考）】:\n${ownExamples.map((p, i) => `例${i + 1}: ${p.text}`).join('\n\n')}\n`
    : '';

  const extSection = extExamples.length > 0
    ? `\n【同ジャンルで伸びている投稿（市場調査・構造模倣用）】:\n${extExamples.map((p, i) => {
      const text = String(p.text ?? '').replace(/\n/g, ' ').slice(0, 120);
      const hasQuestion = /？|\?|どっち|いる/.test(text);
      const hasDiscovery = /見つけ|発見|出会/.test(text);
      const hasNumber = /\d|件|万|位|★/.test(text);
      return `参考${i + 1}: フック=${hasDiscovery ? '発見報告' : hasQuestion ? '問いかけ' : hasNumber ? '数字訴求' : '雑談風'} / 長さ=${text.length}字 / 構造だけ参考: ${text}`;
    }).join('\n')}\n`
    : '';

  const saleHint = type === 'sale'
    ? '\n- ※セール中のため「期間限定」「今だけ」「セール終了前に」といった緊急性ワードを必ず含める'
    : '';

  const actressLine = actress
    ? `- 出演者: ${actress}`
    : '- 出演者: （情報なし。作品タイトルのシナリオから魅力を伝えること）';
  const genreLine = genreList.length > 0
    ? `- ジャンル: ${genreList.join('・')}`
    : '';

  const grokSection = grokResearch
    ? `\n═══════════════════════════════════════
📡 【Grokリアルタイム市場調査結果 — これが最重要情報】
═══════════════════════════════════════
${grokResearch.slice(0, 2000)}
═══════════════════════════════════════
★ 上記の調査結果に基づいて、「今この瞬間にバズる型」でツイートを作ること。
★ Grokが推奨するフック・トーン・切り口を最優先で採用すること。
★ 固定テンプレートのような投稿は厳禁。調査結果を反映した新鮮な文体にすること。
★ 伸びている投稿を丸写しせず、フック・行間・口調・CTAの構造だけを模倣すること。\n`
    : '';

  _lastContentType = grokResearch ? 'Grok調査型' : 'Claude生成型';

  const prompt = `あなたは日本のX（旧Twitter）で毎日バズを生み出すプロのコピーライターです。
以下の作品情報と市場調査結果を元に、「今この瞬間」最もバズりやすいツイートを1件作成してください。

═══════ 作品情報 ═══════
- タイトル: ${title}
- フルタイトル: ${fullTitle}
${actressLine}
${genreLine}
- カテゴリ: ${typeLabel}
- レビュー数: ${reviewCount}件
- 平均評価: ${reviewAvg}点${saleHint}
${grokSection}${ownSection}${extSection}
═══════ 生成ルール ═══════

【構造の自由度】
固定の型は使わない。上記の市場調査結果と同ジャンルの参考投稿から、伸びている「型」を自分で判断して模倣すること。
ただし以下の要素は必ず含める:
① 1行目: スクロールを0.3秒で止めるフック（調査結果で推奨された形式を優先）
② 本文: 作品の具体的な魅力（タイトルのシナリオ展開、女優名、数字のどれか）
③ 最終行: 「リプ欄へ👇」のCTA

【市場模倣ルール】
- 同ジャンルで伸びている投稿の「構成」を真似る
- 例: 発見報告型なら「見つけた」「これ系好きなら」などの自然な口調に寄せる
- 例: 数字訴求型ならレビュー件数や評価を説明臭くなく混ぜる
- 「選んだ理由：」のようなラベル文は禁止
- 広告文ではなく、Xで人が普通に話している文章にする

【バリエーション確保】
- 前回と同じフック・同じ文体は使わない
- 以下のアプローチからランダムに選ぶか、調査結果に最適なものを選ぶ:
  a) シナリオ語り型: タイトルの場面をそのまま物語として語る（「妻の不在中に義妹と…」）
  b) 発見報告型: 「〇〇見つけてしまった」「〇〇がやばすぎる件」
  c) 問いかけ型: 「これわかる人いる？」「どっち派？」
  d) 衝撃事実型: 「レビュー〇〇件ってどういうことだよ」
  e) 背徳感型: 深夜向け。罪悪感・禁断の雰囲気
  f) トレンド便乗型: 今日のトレンドワードと絡める
  g) 実体験風型: 「昨日の夜これ見て寝れなくなった」

【絶対ルール】
- 必ず 🔞 から始める（1文字目）
- ハッシュタグ（#）は一切使わない
- 日本語140文字以内（短いほどバズる）
- 絵文字は0〜3個（多すぎると逆効果）
- 「人気女優」「トップ女優」等の曖昧表現は禁止
- AV女優名がある場合は必ず入れる

以下のJSON形式で出力してください（説明文不要、JSONのみ）:
{
  "tweet": "ツイート本文（🔞から始める）",
  "imagePrompt": "投稿に添える画像のプロンプト（英語）"
}

★★★ imagePromptの生成ルール（最重要 — Pony V6 4-Block構造） ★★★

imagePromptは、この作品の「サムネイル」として使える画像を生成するためのものです。
Pony Diffusion V6 XL（SDXL系）で生成します。4-Block構造で高品質を実現。

【構造】プロンプトは4つのBlockで構成:
Block-A: Technical（品質タグ・score系） → Block-B: Character（年齢/体型/顔） → Block-C: Content（衣装/場面/表情） → Block-D: Style（照明/カメラ）
最後に Negative: で締める

【Block-A: Technical（必ず先頭）】
score_9, score_8_up, score_7_up, source_photo, (masterpiece:1.3), (best quality:1.2), 8k uhd, RAW photo, highres,

【Block-B: Character（年齢層で切り替え）】
■ 20〜25歳（デフォルト）:
1girl, 20yo japanese woman, cute idol face, round chubby cheeks, small cute button nose, large sparkling eyes, gentle smile, see-through bangs, straight medium-length dark brown hair, porcelain skin, natural skin texture with visible pores, light blush, glossy lips,

■ 26〜35歳（OL/人妻/お姉さん系）:
1girl, 28yo japanese woman, beautiful soft feminine features, almond-shaped sophisticated eyes, elegant smile, side-swept bangs, layered dark brown hair, warm natural glow, natural skin texture, delicate collarbone, refined jawline,

■ 36歳以上（熟女/マダム系）:
1girl, 38yo japanese woman, elegant mature beauty, refined features, high cheekbones, deep expressive eyes, sophisticated smile, layered medium-length hair, luminous skin, graceful neck and collarbone,

【Block-C: Content（作品連動 — 最大露出で）】
セクシー共通: (cleavage:1.2), deep neckline, bare shoulders, exposed midriff, skin-tight clothing, alluring pose, glistening skin, dynamic angle,
作品テンプレ: wearing [OUTFIT], in a [SCENE], [EXPRESSION],

タイトル→場面の変換例（サンプル画像の最も露出度の高い衣装を参考に）:
- 制服系 → wearing micro mini sailor uniform, unbuttoned blouse showing cleavage, thigh-high socks, in school hallway with afternoon sunlight, seductive upward gaze
- OL系 → wearing unbuttoned white blouse with visible bra straps, ultra-tight pencil skirt, in modern office at night, seductive lean forward
- 水着系 → wearing string bikini micro triangle top high-cut bottom, at tropical beach golden hour, arching back wet glistening body
- 温泉系 → wearing yukata sliding off one shoulder bare legs, in japanese hot spring inn steamy bath, flushed cheeks wet hair
- ナース → wearing tight nurse uniform deep V neckline thigh-high stockings, in hospital room dim lighting, leaning forward showing cleavage
- メイド → wearing micro maid outfit frilly garter belt bare thighs, in vintage cafe, bending forward playfully
- 人妻 → wearing sheer negligee bare shoulders kitchen apron, in modern kitchen warm lighting, inviting expression
- 巨乳/爆乳 → (large bust:1.3), tight low-cut top deep cleavage push-up effect
- 不倫 → wearing sheer lace lingerie lace teddy, in dimly lit hotel room, seductive lying on bed
- マッサージ → minimal towel barely covering oiled glistening skin, in luxury spa candles, lips parted relaxed sensual

【Block-D: Style（照明・カメラ）】
- 室内接写 → soft studio lighting, kodak portra 400, shallow depth of field, bokeh, shot on Canon EOS R5, 35mm f/1.8
- 屋内半身 → soft studio lighting, kodak portra 400, shallow depth of field, bokeh, shot on Canon EOS R5, 50mm f/2.0
- 屋外全身 → soft studio lighting, kodak portra 400, shallow depth of field, bokeh, shot on Canon EOS R5, 85mm f/1.4
共通: cinematic color grading, film grain

【Negative（必ず末尾に Negative: で始める）】
Negative: score_4, score_3, score_2, score_1, (worst quality:1.4), (low quality:1.4), anime, cartoon, 3d render, doll, uncanny valley, plastic skin, airbrushed skin, wax figure, mannequin, deformed hands, extra fingers, deformed iris, deformed pupils, watermark, text, logo, cropped, blurry

【完成例（制服系）】
score_9, score_8_up, score_7_up, source_photo, (masterpiece:1.3), (best quality:1.2), 8k uhd, RAW photo, highres, 1girl, 20yo japanese woman, cute idol face, round chubby cheeks, small cute button nose, large sparkling eyes, gentle smile, see-through bangs, straight medium-length dark brown hair, porcelain skin, natural skin texture with visible pores, (cleavage:1.2), deep neckline, bare shoulders, alluring pose, glistening skin, wearing micro mini sailor uniform unbuttoned blouse showing cleavage thigh-high socks, in school hallway with afternoon sunlight, seductive upward gaze biting lip, soft studio lighting, kodak portra 400, shallow depth of field, bokeh, shot on Canon EOS R5 35mm f/1.8, cinematic color grading, film grain. Negative: score_4, score_3, score_2, score_1, (worst quality:1.4), (low quality:1.4), anime, cartoon, 3d render, doll, uncanny valley, plastic skin, airbrushed skin, wax figure, mannequin, deformed hands, extra fingers, deformed iris, deformed pupils, watermark, text, logo, cropped, blurry

【禁止事項】
- score_9 タグを省略すること（Pony V6では必須）
- セクシー演出キーワード(cleavage, deep neckline等)を省略すること
- 露出を控えめにすること（最大露出の衣装を常に選ぶ）
- 作品と無関係な一般的ポートレートにすること
- 全て英語で記述すること`;

  const message = await client.messages.create({
    model: grokResearch ? 'claude-sonnet-4-5' : 'claude-haiku-4-5',
    max_tokens: 800,
    messages: [
      { role: 'user', content: prompt },
    ],
  });

  const block = message.content[0];
  if (block.type !== 'text') return null;
  const rawResponse = block.text.trim();

  let text: string;
  let imagePrompt: string | null = null;

  try {
    const cleaned = rawResponse.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    text = (parsed.tweet ?? '').trim();
    imagePrompt = (parsed.imagePrompt ?? '').trim() || null;
  } catch {
    const raw = rawResponse.startsWith('🔞') ? rawResponse : '🔞' + rawResponse;
    text = raw.trim();
  }

  text = text.replace(/#[\w\u3000-\u9fff\uff01-\uff60]+/g, '').replace(/\s+\n/g, '\n').trim();

  if (text.length < 10 || text.length > 450) return null;
  if (isRefusal(text)) {
    console.warn('  ⚠ Claude が拒否応答を返したためテンプレートで代替');
    return null;
  }
  if (!isValidTweet(text)) {
    console.warn('  ⚠ Claude 応答が必須要素を欠くためテンプレートで代替');
    return null;
  }
  console.log(`  🖼️ 画像プロンプト${imagePrompt ? '生成済み' : 'なし'}`);
  return { text, imagePrompt };
}

// ─── 芸能人スロット専用：AI生成 ─────────────────────────────────────────────

export async function generateCelebrityMainTweet(
  celebrity: string,
  hook: string,
  item: any,
): Promise<string> {
  const actress = item.actress?.map((a: any) => a.name).join('・') || shortTitle(item.title, 15);
  const reviewAvg = item.review?.average ?? '4.5';
  const reviewCount = item.review?.count ?? 0;
  const title = item.title?.slice(0, 40) ?? '';

  const fallback = [
    `🔞${hook}`,
    ``,
    `出演: ${actress}`,
    `⭐${reviewAvg}点 / レビュー${reviewCount}件`,
    ``,
    `詳細はリプ欄👇`,
  ].join('\n');

  const claude = makeAnthropicClient();
  if (!claude) return fallback;

  // 会議知見・アルゴ解析・過去実績を動的に取得してプロンプトに注入
  const knowledgeContext = buildCelebrityPostContext();

  try {
    const prompt = `あなたは日本のXで成果を出しているアダルトアフィリエイターです。
「${celebrity}に激似の女優を発見した」という切り口で、スクロールが止まるツイートを1件作成してください。${knowledgeContext}

## 今回の作品情報
- 芸能人（似ている対象）: ${celebrity}
- フック候補: 「${hook}」
- 出演AV女優: ${actress}
- 作品タイトル（参考）: ${title}
- レビュー: ⭐${reviewAvg}点（${reviewCount}件）

## 成功するツイートの構造
1行目（0.3秒で止める）: ${celebrity}の名前を使って強烈な一言
2行目: 具体的な発見・理由（なぜ似てるのか/どこが魅力か）
3行目: AV女優名 + レビュー数字で信頼担保
4行目: 「詳細はリプ欄👇」で誘導

## バズ事例（参考）
- 「新垣結衣そっくりの子がいて頭おかしくなった」→ いいね2000超
- 「石原さとみ似の女優、見つけてしまったすまない」→ RT1500超
- 「綾瀬はるかに似すぎてて笑えない件」→ インプ30万超

## 絶対ルール
- 必ず 🔞 から始める（1文字目）
- ハッシュタグ（#）は絶対に入れない
- 日本語で110文字以内（短いほど良い）
- 絵文字は2〜4個まで
- 「リプ欄へ👇」または「詳細はリプ欄👇」で締める
- 「人気女優」「トップ女優」等の曖昧な表現禁止
- AV女優名を必ず入れる

ツイート本文だけ出力してください（説明文不要）:`;

    const message = await claude.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: '🔞' },
      ],
    });

    const block = message.content[0];
    if (block.type !== 'text') return fallback;
    const raw = ('🔞' + block.text).trim();
    const text = raw.replace(/#[\w\u3000-\u9fff\uff01-\uff60]+/g, '').replace(/\s+\n/g, '\n').trim();

    if (text.length < 15 || text.length > 450) return fallback;
    if (isRefusal(text)) { console.warn('  ⚠ 芸能人ツイートClaude拒否 → テンプレート使用'); return fallback; }
    console.log('  ✨ [芸能人] Claude生成成功');
    return text;
  } catch (e: any) {
    console.warn(`  ⚠ 芸能人ツイートClaude失敗 → テンプレート使用: ${e.message}`);
    return fallback;
  }
}

export async function generateCelebrityIntroReply(introLine: string, item: any): Promise<string> {
  const title = item.title?.slice(0, 35) ?? '';
  const actress = item.actress?.map((a: any) => a.name).join('・') || shortTitle(item.title, 15);
  const reviewAvg = item.review?.average ?? '4.5';
  const reviewCount = item.review?.count ?? 0;

  const fallback = [
    introLine,
    ``,
    `👤 ${actress}`,
    `🎬 「${title}」`,
  ].join('\n');

  const claude = makeAnthropicClient();
  if (!claude) return fallback;

  try {
    const prompt = `以下の情報をもとに、Xのリプライツイート（自己リプ）を1件作成してください。
メインツイートで「芸能人に似た女優を発見した」と書いた続きのリプライです。

## 作品情報
- 出演女優: ${actress}
- 作品タイトル: ${title}
- レビュー: ⭐${reviewAvg}点（${reviewCount}件）
- 紹介文のヒント: 「${introLine}」

## このリプライの目的
- 女優の具体的な魅力・特徴を伝える
- 「見たい！」と思わせる
- 次のリプライ（URLリンク）への橋渡し

## ルール
- ハッシュタグ（#）絶対禁止
- 絵文字2〜5個
- 100文字以内
- 女優名・作品名・レビュー数字を必ず入れる
- 最後は「🔗次のポストにリンクあります」または「↓リンクはこの下」で締める

リプライ本文だけ出力してください:`;

    const message = await claude.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 250,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = message.content[0];
    if (block.type !== 'text') return fallback;
    const raw = block.text.trim();
    const text = raw.replace(/#[\w\u3000-\u9fff\uff01-\uff60]+/g, '').replace(/\s+\n/g, '\n').trim();
    if (text.length < 10 || text.length > 400) return fallback;
    if (isRefusal(text)) return fallback;
    console.log('  ✨ [芸能人リプライ] Claude生成成功');
    return text;
  } catch (e: any) {
    console.warn(`  ⚠ 芸能人リプライClaude失敗 → テンプレート使用: ${e.message}`);
    return fallback;
  }
}

// ─── メインエクスポート────────────────────────────────────────────────────

export async function generateTweetText(
  item: any,
  type: string,
  topPatterns: any[] = [],
  externalPatterns: any[] = [],
  grokResearch?: string,
): Promise<TweetWithImagePrompt> {
  try {
    const result = await generateWithClaude(item, type, topPatterns, externalPatterns, grokResearch);
    if (result) {
      console.log('  ✨ Claude で文章生成成功');
      return result;
    }
  } catch (e: any) {
    console.warn(`  ⚠ Claude 生成失敗、テンプレートで代替: ${e.message}`);
  }

  console.log('  📝 テンプレートで文章生成');
  const text = buildTemplateText(item, type);
  const { buildImagePrompt } = await import('./imageGen.js');
  const imagePrompt = buildImagePrompt(text, item.title);
  return { text, imagePrompt };
}

// ─── 手動投稿フィードバック生成 ──────────────────────────────────────────────

interface ManualTweetData {
  id: string;
  text: string;
  created_at: string;
  likes: number;
  rt: number;
  replies: number;
  impressions: number;
}

export async function buildManualPostFeedback(days = 7): Promise<{
  tweetCount: number;
  avgEngagement: number;
  topTweet: { text: string; likes: number; rt: number };
  analysis: string;
  suggestions: string[];
  hookVariety: string[];
  weekStart: string;
  weekEnd: string;
} | null> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  // 1. 直近N日のツイートを取得
  const allTweets = await getOwnRecentTweets(100);
  const recentTweets = allTweets.filter(
    (t: any) => t.created_at && new Date(t.created_at) >= since,
  );

  // 2. ボット投稿IDを除外して手動投稿だけ残す
  const botPosts = getPostsAfter(since);
  const botIds = new Set<string>();
  botPosts.forEach((p: any) => {
    if (p.tweetId) botIds.add(p.tweetId);
    if (p.replyId) botIds.add(p.replyId);
  });

  const manualTweets: ManualTweetData[] = recentTweets
    .filter((t: any) => !botIds.has(t.id))
    .map((t: any) => ({
      id: t.id,
      text: t.text,
      created_at: t.created_at ?? '',
      likes: t.public_metrics?.like_count ?? 0,
      rt: t.public_metrics?.retweet_count ?? 0,
      replies: t.public_metrics?.reply_count ?? 0,
      impressions: t.public_metrics?.impression_count ?? 0,
    }));

  // リツイートを除外（自分の投稿のみ）
  const ownTweets = manualTweets.filter(t => !t.text.startsWith('RT @'));

  if (ownTweets.length === 0) {
    console.log('  ℹ️  手動投稿FB: 対象ツイートなし（全てRT）');
    return null;
  }

  // 3. エンゲージメントスコア計算（RTを除いた自分の投稿のみ）
  const engScore = (t: ManualTweetData) => t.likes + t.rt * 2 + t.replies * 3;
  const avgEngagement =
    Math.round(
      (ownTweets.reduce((s, t) => s + engScore(t), 0) / ownTweets.length) * 10,
    ) / 10;
  const topTweet = ownTweets.reduce((best, t) =>
    engScore(t) > engScore(best) ? t : best,
  );

  // 4. Claude分析（claude-sonnet-4-5）
  const tweetSummary = ownTweets
    .slice(0, 15)
    .map(
      (t, i) =>
        `[${i + 1}] ${t.text.slice(0, 120)}\n  → ❤️${t.likes} 🔁${t.rt} 💬${t.replies} 👁${t.impressions}`,
    )
    .join('\n\n');

  const prompt = `以下はTwitterアカウント(@gomi_shu_god)の直近${days}日間の手動投稿一覧です（🔞フック + 恋愛・共感系テーマ）。

${tweetSummary}

以下の形式でJSONのみで回答してください（余計な説明不要）:
{
  "analysis": "全体評価（2-3文、日本語）",
  "suggestions": ["改善提案1", "改善提案2", "改善提案3"],
  "hookVariety": ["使われたフック型の名称リスト（例: 質問型, 選択肢型, 共感型, あるある型, 告白型）"]
}

評価観点: フック力、内容の多様性、エンゲージメント誘導の質、🔞 + 恋愛テーマの一貫性、インプレッション効率`;

  let analysisResult: { analysis: string; suggestions: string[]; hookVariety: string[] } = {
    analysis: '分析データなし',
    suggestions: [],
    hookVariety: [],
  };

  try {
    const baseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
    const apiKey  = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
    if (!baseUrl || !apiKey) throw new Error('Anthropic env vars not set');
    const fbClient = new Anthropic({ baseURL: baseUrl, apiKey });
    const claudeRes = await fbClient.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = claudeRes.content[0];
    if (content.type === 'text') {
      analysisResult = JSON.parse(content.text.replace(/```json\n?|\n?```/g, '').trim());
    }
  } catch (e: any) {
    console.warn('  ⚠ 手動投稿FB Claude分析失敗:', e.message);
  }

  // 5. 週の日付計算（JST基準）
  const nowJst = new Date(Date.now() + 9 * 3600000);
  const weekEnd = nowJst.toISOString().slice(0, 10);
  const weekStart = new Date(nowJst.getTime() - days * 24 * 3600000)
    .toISOString()
    .slice(0, 10);

  return {
    tweetCount: ownTweets.length,
    avgEngagement,
    topTweet: { text: topTweet.text, likes: topTweet.likes, rt: topTweet.rt },
    analysis: analysisResult.analysis,
    suggestions: analysisResult.suggestions ?? [],
    hookVariety: analysisResult.hookVariety ?? [],
    weekStart,
    weekEnd,
  };
}
