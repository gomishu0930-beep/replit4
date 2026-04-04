import Anthropic from '@anthropic-ai/sdk';

const TEMPLATES: Record<string, string[]> = {
  amateur: [
    '🔞💕【素人】\n{actress}ちゃんの本物感がたまらない✨\n「{shortTitle}」\n\nレビュー{reviewCount}件・平均{reviewAvg}点の高評価🔥\nリンクはリプ欄へ👇\n#FANZA #fanza #素人',
    '🔞🎀 素人娘の破壊力がすごい\n出演：{actress}\n「{shortTitle}」\n\n⭐{reviewAvg}点（{reviewCount}件）の人気作💫\n詳細はリプ欄から👇\n#FANZA #fanza #素人',
    '🔞🌸 素人系で今一番アツい作品\n{actress}「{shortTitle}」\n\nリアルな雰囲気がたまらない💓\nレビュー平均{reviewAvg}点の高評価作品🏆\n#FANZA #fanza #素人',
  ],
  rank: [
    '🔞【ランキング{rank}位】\n{actress}主演の話題作✨\n「{shortTitle}」\nレビュー{reviewCount}件・平均{reviewAvg}点の高評価作品🔥\nサンプル画像チェック必須👀\n#FANZA #fanza #{genreTag}',
    '🔞📊 今週の注目作品！\n{actress}が魅せる圧巻のパフォーマンス💥\n「{shortTitle}」\n⭐{reviewAvg}点（{reviewCount}件）の超高評価\nランキング上位常連の名作🏆\n#FANZA #fanza #{genreTag}',
    '🔞🔥 ランキング急上昇中\n出演：{actress}\nタイトル：{shortTitle}\n\nレビュー平均{reviewAvg}点の話題作🌟\nリンクはリプ欄へ👇\n#FANZA #fanza #{genreTag}',
  ],
  sale: [
    '🔞💸【セール開催中】\n{actress}出演の人気作が今だけお得🎉\n「{shortTitle}」\n\n⭐{reviewAvg}点（{reviewCount}件評価）\n見逃し厳禁！リンクはリプへ👇\n#FANZA #fanza #セール #{genreTag}',
    '🔞🏷️ お得なセール情報！\n{actress}主演「{shortTitle}」が\n期間限定でお求めやすく💰\n\nレビュー{reviewCount}件・{reviewAvg}点の安心作品✅\n今がチャンス🔥\n#FANZA #fanza #セール #{genreTag}',
    '🔞✨ セール中の注目作！\n出演：{actress}\n「{shortTitle}」\n\nお得な価格で楽しめる期間限定チャンス💫\n⭐平均{reviewAvg}点の高評価作品\n#FANZA #fanza #お得 #{genreTag}',
  ],
  buzz: [
    '🔞🚀【話題沸騰中】\n{actress}主演の超高評価作品\n「{shortTitle}」\n\n⭐{reviewAvg}点・{reviewCount}件のレビューが証明する実力派👑\n今一番アツい作品🔥\n#FANZA #fanza #{genreTag}',
    '🔞💬 レビュー{reviewCount}件の圧倒的人気作\n{actress}「{shortTitle}」\n\n平均{reviewAvg}点という驚異の評価🌟\nバズってる理由を確認してみて👀\n#FANZA #fanza #{genreTag}',
    '🔞🏆 今最も話題の作品\n出演：{actress}\n「{shortTitle}」\n\nレビュー平均{reviewAvg}点（{reviewCount}件）\n口コミが止まらない神作品✨\n#FANZA #fanza #{genreTag}',
  ],
  random: [
    '🔞💎【隠れた名作】\n{actress}主演「{shortTitle}」\n\nコアなファンに絶大な人気🎬\n⭐{reviewAvg}点の高評価にも注目\nリンクはリプ欄へ👇\n#FANZA #fanza #{genreTag}',
    '🔞🎯 こんな作品どうですか？\n{actress}「{shortTitle}」\n\nレビュー{reviewCount}件・平均{reviewAvg}点✨\nまだ見ていないなら絶対チェック📌\n#FANZA #fanza #{genreTag}',
    '🔞🌟 おすすめ作品のご紹介\n出演：{actress}\n「{shortTitle}」\n\n⭐{reviewAvg}点の安定した高評価🎖️\n詳細はリプ欄から👇\n#FANZA #fanza #{genreTag}',
  ],
};

const DEFAULT_TEMPLATES = [
  '🔞✨ 注目の人気作\n{actress}「{shortTitle}」\n\nレビュー{reviewCount}件・平均{reviewAvg}点の高評価作品🌟\nリンクはリプ欄へ👇\n#FANZA #fanza #{genreTag}',
];

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

async function generateWithClaude(item: any, type: string, topPatterns: any[], externalPatterns: any[] = []): Promise<string | null> {
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
    ? `\n【自分の過去高エンゲージメント投稿】:\n${ownExamples.map((p, i) => `例${i + 1}: ${p.text}`).join('\n\n')}\n`
    : '';

  const extSection = extExamples.length > 0
    ? `\n【他アカウントの高エンゲージメント投稿（スタイル参考のみ）】:\n${extExamples.map((p, i) => `参考${i + 1}: ${p.text}`).join('\n\n')}\n`
    : '';

  const prompt = `あなたは日本のSNSコピーライターです。動画配信サービスのアフィリエイト用ツイートを1件作成してください。

作品情報:
- タイトル: ${title}
- 出演者: ${actress}
- カテゴリ: ${typeLabel}
- レビュー数: ${reviewCount}件
- 平均評価: ${reviewAvg}点
- ハッシュタグ: #${genreTag}
${ownSection}${extSection}
出力ルール（厳守）:
- 必ず 🔞 から始める（1文字目）
- 日本語140文字以内
- 末尾に必ず #FANZA #fanza #${genreTag} を付ける
- 「リンクはリプ欄へ👇」を必ず含める
- 絵文字を2〜4個使う
- 参考例のスタイルを参考にしつつ新しい表現にする

ツイート本文だけを出力してください:`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 300,
    messages: [
      { role: 'user', content: prompt },
      { role: 'assistant', content: '🔞' },
    ],
  });

  const block = message.content[0];
  if (block.type !== 'text') return null;
  // アシスタントの事前入力「🔞」と結合する
  const text = ('🔞' + block.text).trim();

  if (text.length < 10 || text.length > 400) return null;
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

const REFUSAL_PATTERNS = [
  'できません',
  '申し訳',
  'お断り',
  'ご連絡いただきありがとう',
  'unable to',
  'i cannot',
  "i'm unable",
  'i am unable',
  'not able to',
  'nsfw',
  'adult content',
  'promotional content for',
  'affiliate marketing',
  'i apologize',
  'unfortunately',
  'cannot assist',
  'cannot create',
  'cannot help',
  'content policy',
  'お手伝いいたします', // 拒否後の代替提案フレーズ
];

function isRefusal(text: string): boolean {
  const lower = text.toLowerCase();
  return REFUSAL_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

function isValidTweet(text: string): boolean {
  return text.includes('🔞') && text.includes('#FANZA');
}

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
