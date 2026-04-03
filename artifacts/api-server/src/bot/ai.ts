const TEMPLATES: Record<string, string[]> = {
  rank: [
    '🔞【ランキング{rank}位】\n{actress}主演の話題作✨\n「{shortTitle}」\nレビュー{reviewCount}件・平均{reviewAvg}点の高評価作品🔥\nサンプル画像チェック必須👀\n#FANZA #fanza #{genreTag}',
    '🔞📊 今週の注目作品！\n{actress}が魅せる圧巻のパフォーマンス💥\n「{shortTitle}」\n⭐{reviewAvg}点（{reviewCount}件）の超高評価\nランキング上位常連の名作🏆\n#FANZA #fanza #{genreTag}',
    '🔞🔥 ランキング急上昇中\n出演：{actress}\nタイトル：{shortTitle}\n\nレビュー平均{reviewAvg}点の話題作です🌟\nリンクはリプ欄へ👇\n#FANZA #fanza #{genreTag}',
  ],
  sale: [
    '🔞💸【セール開催中】\n{actress}出演の人気作が今だけお得🎉\n「{shortTitle}」\n\n⭐{reviewAvg}点（{reviewCount}件評価）\n見逃し厳禁のセール品！リンクはリプへ👇\n#FANZA #fanza #セール #{genreTag}',
    '🔞🏷️ お得なセール情報！\n{actress}主演「{shortTitle}」が\n期間限定でお求めやすく💰\n\nレビュー{reviewCount}件・{reviewAvg}点の安心作品✅\n今がチャンス🔥 リンクはリプ欄へ\n#FANZA #fanza #セール #{genreTag}',
    '🔞✨ セール中の注目作！\n出演：{actress}\n「{shortTitle}」\n\nお得な価格で楽しめる期間限定チャンス💫\n⭐平均{reviewAvg}点の高評価作品\n#FANZA #fanza #お得 #{genreTag}',
  ],
  buzz: [
    '🔞🚀【話題沸騰中】\n{actress}主演の超高評価作品\n「{shortTitle}」\n\n⭐{reviewAvg}点・{reviewCount}件のレビューが証明する実力派👑\n今一番アツい作品です🔥\n#FANZA #fanza #{genreTag}',
    '🔞💬 レビュー{reviewCount}件の圧倒的人気作\n{actress}「{shortTitle}」\n\n平均{reviewAvg}点という驚異の評価🌟\nバズってる理由を確認してみて👀\nリンクはリプ欄へ👇\n#FANZA #fanza #{genreTag}',
    '🔞🏆 今最も話題の作品\n出演：{actress}\n「{shortTitle}」\n\nレビュー平均{reviewAvg}点（{reviewCount}件）\n口コミが止まらない神作品✨\n#FANZA #fanza #{genreTag}',
  ],
  random: [
    '🔞💎【隠れた名作】\n{actress}主演「{shortTitle}」\n\nコアなファンに絶大な人気の通好み作品🎬\n⭐{reviewAvg}点の高評価にも注目\nリンクはリプ欄へ👇\n#FANZA #fanza #{genreTag}',
    '🔞🎯 こんな作品どうですか？\n{actress}「{shortTitle}」\n\nレビュー{reviewCount}件・平均{reviewAvg}点✨\nまだ見ていないなら絶対チェック📌\n#FANZA #fanza #{genreTag}',
    '🔞🌟 おすすめ作品のご紹介\n出演：{actress}\n「{shortTitle}」\n\n⭐{reviewAvg}点の安定した高評価🎖️\n詳細はリプ欄のリンクから👇\n#FANZA #fanza #{genreTag}',
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

export async function generateTweetText(item: any, type: string): Promise<string> {
  const actress = item.actress?.map((a: any) => a.name).join('・') || '人気女優';
  const reviewCount = item.review?.count ?? 0;
  const reviewAvg = item.review?.average ?? '4.5';
  const genreTag = getGenreTag(item);
  const title = shortTitle(item.title);

  const pool = TEMPLATES[type] || DEFAULT_TEMPLATES;
  const template = pickRandom(pool);

  return template
    .replace(/{actress}/g, actress)
    .replace(/{shortTitle}/g, title)
    .replace(/{reviewCount}/g, String(reviewCount))
    .replace(/{reviewAvg}/g, String(reviewAvg))
    .replace(/{genreTag}/g, genreTag)
    .replace(/{rank}/g, String(Math.floor(Math.random() * 10) + 1));
}
