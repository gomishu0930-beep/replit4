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

const IMPRESSION_TEMPLATES: string[] = [
  // 感情・共感型
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
): Promise<TweetWithImagePrompt | null> {
  const baseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  if (!baseUrl || !apiKey) return null;

  const client = new Anthropic({ baseURL: baseUrl, apiKey });

  const actressRaw = item.actress?.map((a: any) => a.name).join('・') || '';
  const actress = actressRaw; // 空の場合はClaudeプロンプト内で適切に処理
  const reviewCount = item.review?.count ?? 0;
  const reviewAvg = item.review?.average ?? '4.5';
  const title = shortTitle(item.title, 30);
  const fullTitle = item.title ?? title; // シナリオ型用にフルタイトルを渡す
  const typeLabel = buildTypeLabel(type);

  const ownExamples = topPatterns.slice(0, 2);
  const extExamples = externalPatterns.slice(0, 2);

  const ownSection = ownExamples.length > 0
    ? `\n【自分の過去高エンゲージメント投稿（スタイル参考）】:\n${ownExamples.map((p, i) => `例${i + 1}: ${p.text}`).join('\n\n')}\n`
    : '';

  const extSection = extExamples.length > 0
    ? `\n【他アカウントの高エンゲージメント投稿（スタイル参考のみ）】:\n${extExamples.map((p, i) => `参考${i + 1}: ${p.text}`).join('\n\n')}\n`
    : '';

  // セール情報（スロット種別がsaleの場合は詳細を渡す）
  const saleHint = type === 'sale'
    ? '\n- ※セール中のため「期間限定」「今だけ」「セール終了前に」といった緊急性ワードを必ず含める'
    : '';

  // 投稿毎に6型をランダム選択（同型文の連投を防ぐ）
  const contentTypes = [
    {
      name: 'レビュー型',
      hook: '「正直に言う」「実際に確かめた」「結論を言う」系のフック',
      style: '個人の感想・体験談として書く。「〜だった」「〜がわかった」の過去形が効果的。',
    },
    {
      name: '比較型',
      hook: '「〜よりも」「〜より断然」「比較した結果」系のフック',
      style: '何かと比較して優位性を示す。「他と違う点」を1つ具体的に挙げる。',
    },
    {
      name: 'ランキング型',
      hook: '「今一番」「個人的1位」「ぶっちぎり」系のフック',
      style: '順位・序列で表現する。「なぜこれが1位か」の理由を1行で添える。',
    },
    {
      name: '失敗回避型',
      hook: '「知らないと損」「見逃すと後悔」「注意して」系のフック',
      style: '「このまま知らずにいると〜」という危機感から入り、解決策として作品を提示。',
    },
    {
      name: '共感型',
      hook: '「あるある」「これわかる人いる？」「正直に言う」系のフック',
      style: 'ユーザーが共感する状況・感情から始め、自然に作品につなげる。問いかけで終わると反応率UP。',
    },
    {
      name: 'シナリオ型',
      hook: 'FANZAのタイトルに書かれているシチュエーションをそのまま物語として語る。タイトルを見ればシナリオはすでにある。',
      style: `
★ 最重要ルール：FANZAのタイトルには「誰が・誰と・どこで・どういう状況か」が既に書かれている。それをそのまま物語口調にして語ること。創作は不要。

構造（以下を厳守）：
  1行目：作品のシチュエーションから引き出した禁断・背徳フレーズ
          例：タイトルに「妻が一人旅で不在中、義妹とホテルで〜」→「妻の不在中に義妹と…ダメだとわかってる。でも」
  2〜3行目：タイトルのシナリオを自然な文章で語る（タイトルを言い換える感じ）
  最後行：「AV女優名：{actress}」を必ず入れ → 「リプ欄へ👇」

参考：
  タイトル「妻が一人旅で不在中、義妹のみあとホテルでお泊り不倫デート」
  → ツイート「不倫はダメだが、それが気持ち良い。妻が一人旅で不在中、義妹のみあとホテルで密会お泊り不倫。妻との関係が冷めていく中で、可愛すぎる義妹に… AV女優名：七沢みあ / リプ欄へ👇」

フルタイトル（参考にしてよい）：${fullTitle}`,
    },
  ];

  // シナリオ型の選択確率を高める（参考ツイートの高エンゲージメントを反映）
  const typeWeights = [1, 1, 1, 1, 1, 2]; // シナリオ型は2倍
  const totalWeight = typeWeights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * totalWeight;
  let selectedTypeIdx = 0;
  for (let i = 0; i < typeWeights.length; i++) {
    rand -= typeWeights[i];
    if (rand <= 0) { selectedTypeIdx = i; break; }
  }
  const selectedType = contentTypes[selectedTypeIdx];
  _lastContentType = selectedType.name; // 型を記録（schedulerがrecordPostで使用）

  const actressLine = actress
    ? `- 出演者: ${actress}`
    : '- 出演者: （情報なし。作品タイトルのシナリオから魅力を伝えること）';

  const prompt = `あなたは日本のSNSバイラルコンテンツの専門家です。動画配信サービスの紹介ツイートを1件作成してください。

作品情報:
- タイトル: ${title}
${actressLine}
- カテゴリ: ${typeLabel}
- レビュー数: ${reviewCount}件
- 平均評価: ${reviewAvg}点${saleHint}
${ownSection}${extSection}
【今回の投稿タイプ：${selectedType.name}】
フック例: ${selectedType.hook}
文体: ${selectedType.style}

【バズるための絶対ルール】
① 1行目：スクロールを止めるフック（${selectedType.name}らしいもの）
② 2〜3行目：具体的な情報（出演者・タイトルまたはシナリオ）
③ 数字の根拠 or AV女優名を明記（どちらか必ず入れる）
④ 最後：「リプ欄へ👇」または「以下ポスト欄よりリンクをご覧下さい。」のCTA

【厳守事項】
- 必ず 🔞 から始める（1文字目）
- ハッシュタグ（#）は一切使わない ← 重要
- 日本語140文字以内
- 絵文字は1〜3個（シナリオ型は絵文字少なめでリアル感を出す）
- 「リプ欄へ👇」を含める
- 「人気女優」「トップ女優」「著名女優」などの曖昧な表現は使わない ← 厳禁

以下のJSON形式で出力してください（説明文不要、JSONのみ）:
{
  "tweet": "ツイート本文（🔞から始める）",
  "imagePrompt": "投稿に添える画像のプロンプト（英語）"
}

imagePromptのルール:
- 共通顔ベース必須: RAW photo, cute japanese idol girl, baby face, round chubby cheeks, small cute button nose, large round sparkling eyes with aegyo sal, soft rounded facial features, gentle smile, see-through bangs, dark brown hair, natural skin texture with visible pores, fine peach fuzz on cheeks
- カメラ: shot on Sony A7IV 85mm f/1.4, film grain, volumetric haze
- 作品の雰囲気に合わせた衣装・シチュエーション・背景を追加（例: 水着→beach, ナース→hospital）
- ネガティブ末尾必須: Negative: nude, naked, explicit, cartoon, anime, CGI, plastic skin, airbrushed skin
- 全て英語で記述`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 600,
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
): Promise<TweetWithImagePrompt> {
  try {
    const result = await generateWithClaude(item, type, topPatterns, externalPatterns);
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
