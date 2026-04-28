/**
 * fanza-templates.ts
 * 7種類の文体カテゴリごとに自然な投稿テンプレートを管理する。
 * AIっぽさを排除し、人間味のある文体を提供する。
 *
 * 禁止事項: 露骨な性的表現・未成年連想・実在人物を模した表現・過度な誇張・詐欺的表現
 */

export type TemplateCategory =
  | 'friend'    // 友達にすすめる自然な口調
  | 'promo'     // 少しだけ煽る販促口調
  | 'sale'      // セール・割引訴求
  | 'ranking'   // ランキング紹介
  | 'night'     // 夜向けの軽い雑談風
  | 'review'    // レビュー風
  | 'compare';  // 比較・おすすめ風

export interface TemplateResult {
  text: string;
  templateCategory: TemplateCategory;
  templateType: string;  // カテゴリ内の識別子（例: friend-1, review-2）
}

// ─── プレースホルダー変数 ─────────────────────────────────────────────────────
// {actress}      女優名
// {shortTitle}   タイトル（短縮）
// {reviewAvg}    レビュー平均点
// {reviewCount}  レビュー件数
// {genre}        ジャンル

// ─── 1. 友達にすすめる自然な口調 ──────────────────────────────────────────────
const FRIEND_TEMPLATES = [
  {
    id: 'friend-1',
    text: '🔞ちょっといいですか\n\n最近見た中でこれが一番ハマった\n{actress}さんの「{shortTitle}」\n\nレビュー{reviewCount}件で評価{reviewAvg}点、伊達じゃないです\nよかったら覗いてみてください👇',
  },
  {
    id: 'friend-2',
    text: '🔞これ、普通に話したいんですが\n\n{actress}さんの作品\n「{shortTitle}」\n\n見てる間、何度も巻き戻した\nそのくらい良かった\n\nリプ欄にリンク置いておきます',
  },
  {
    id: 'friend-3',
    text: '🔞久しぶりに当たりを引いた気がして\n\n{actress}「{shortTitle}」\nレビュー{reviewCount}件・{reviewAvg}点\n\nこういう作品に出会えると嬉しくなる\n気になる方はリプ欄へ👇',
  },
  {
    id: 'friend-4',
    text: '🔞正直に言います\n\n{actress}さんのこの作品\n「{shortTitle}」\n\n誰かに話したくて仕方なかった\nレビュー{reviewAvg}点の実力、本物だった\n\nリプ欄でどうぞ👇',
  },
  {
    id: 'friend-5',
    text: '🔞こっそり教えます\n\n{actress}さんの作品を\n「{shortTitle}」\n\n周りに話したら絶対見るだろうなってやつ\nレビュー{reviewCount}件が証明してる\n👇リプ欄へ',
  },
];

// ─── 2. 少しだけ煽る販促口調 ──────────────────────────────────────────────────
const PROMO_TEMPLATES = [
  {
    id: 'promo-1',
    text: '🔞これ見逃したら後悔します\n\n{actress}「{shortTitle}」\nレビュー{reviewCount}件・{reviewAvg}点の評価が全てを語ってる\n\n迷う時間がもったいない\nリプ欄で確認してください👇',
  },
  {
    id: 'promo-2',
    text: '🔞まだ見てないんですか\n\n{actress}「{shortTitle}」\n\nレビュー平均{reviewAvg}点\nこの数字、フロックじゃないです\n\nリプ欄のリンクからどうぞ👇',
  },
  {
    id: 'promo-3',
    text: '🔞正直、これは早い者勝ちです\n\n{actress}「{shortTitle}」\n⭐{reviewAvg}点({reviewCount}件)\n\n見た人の感想が止まらない理由\nリプ欄で確かめてください👇',
  },
  {
    id: 'promo-4',
    text: '🔞今すぐチェックしてほしい理由があります\n\n{actress}の新作\n「{shortTitle}」\n\nレビュー{reviewCount}件が語る圧倒的なクオリティ\n後回しにしないほうがいい\n👇リプ欄へ',
  },
];

// ─── 3. セール・割引訴求 ────────────────────────────────────────────────────────
const SALE_TEMPLATES = [
  {
    id: 'sale-1',
    text: '🔞これ、今だけお得になってます\n\n{actress}「{shortTitle}」\nレビュー{reviewCount}件・{reviewAvg}点の高評価作品がセール中\n\n終わる前に見ておいて損はない\n👇リプ欄でチェック',
  },
  {
    id: 'sale-2',
    text: '🔞お得情報、共有します\n\n{actress}さんのこの作品\n「{shortTitle}」\n\n⭐{reviewAvg}点({reviewCount}件)なのに期間限定価格\nこういうの、終わってから後悔するやつです\n\nリプ欄へ👇',
  },
  {
    id: 'sale-3',
    text: '🔞普段この価格で買えないやつです\n\n{actress}「{shortTitle}」\nレビュー平均{reviewAvg}点の実力作品がセール対象\n\n気になってた人は今がチャンス\n👇リプ欄からどうぞ',
  },
  {
    id: 'sale-4',
    text: '🔞セールで掘り出し物を見つけました\n\n{actress}「{shortTitle}」\n⭐{reviewAvg}({reviewCount}件)\n\nこのクオリティでこの価格は珍しい\nリプ欄でご確認ください👇',
  },
  {
    id: 'sale-5',
    text: '🔞節約しながら楽しむなら今\n\n{actress}「{shortTitle}」\nレビュー{reviewCount}件・評価{reviewAvg}点\n\nセール中のうちに見ておくのが正解です\n👇リプ欄へ',
  },
];

// ─── 4. ランキング紹介 ─────────────────────────────────────────────────────────
const RANKING_TEMPLATES = [
  {
    id: 'ranking-1',
    text: '🔞ランキング上位に入ってる作品、確かめてみた\n\n{actress}「{shortTitle}」\n\nレビュー{reviewCount}件・{reviewAvg}点\n納得の評価でした\n\n気になる方はリプ欄へ👇',
  },
  {
    id: 'ranking-2',
    text: '🔞売れてる作品には理由があります\n\n{actress}「{shortTitle}」\n⭐{reviewAvg}点({reviewCount}件)\n\nランキング上位の常連、見てわかりました\nリプ欄にリンクあります👇',
  },
  {
    id: 'ranking-3',
    text: '🔞人気の理由を自分で確かめてきました\n\n{actress}「{shortTitle}」\nレビュー{reviewCount}件・平均{reviewAvg}点\n\n正直、このクオリティなら当然だと思う\nリプ欄からどうぞ👇',
  },
  {
    id: 'ranking-4',
    text: '🔞みんなが選ぶ理由、見てわかった\n\n{actress}「{shortTitle}」\n⭐{reviewAvg}({reviewCount}件の支持)\n\n数字だけじゃなく中身が伴ってる\n👇リプ欄でチェック',
  },
];

// ─── 5. 夜向けの軽い雑談風 ─────────────────────────────────────────────────────
const NIGHT_TEMPLATES = [
  {
    id: 'night-1',
    text: '🔞深夜になんとなく開いたら\n\n{actress}「{shortTitle}」に出会って\nしばらく時間を忘れてた\n\nレビュー{reviewAvg}点、本物でした\n同じ夜更かし組はリプ欄へ👇',
  },
  {
    id: 'night-2',
    text: '🔞夜中に誰かと話したくなる時ってありますよね\n\nそういう気分の時に見つけたのが\n{actress}「{shortTitle}」\n\nレビュー{reviewCount}件・{reviewAvg}点の作品\nリプ欄においてます👇',
  },
  {
    id: 'night-3',
    text: '🔞眠れない夜に見つけました\n\n{actress}「{shortTitle}」\n\n⭐{reviewAvg}点({reviewCount}件)\nこういう夜に合う作品でした\n\nリプ欄でどうぞ👇',
  },
  {
    id: 'night-4',
    text: '🔞夜中に一人でゆっくり見るのが好きで\n\n今日は{actress}の「{shortTitle}」\nレビュー{reviewCount}件の支持が納得できた\n\n夜更かし仲間はリプ欄へ👇',
  },
  {
    id: 'night-5',
    text: '🔞また夜更かしをしてしまった\n\n{actress}「{shortTitle}」が止まらなかったのが原因\n⭐{reviewAvg}点({reviewCount}件)\n\n明日後悔するとわかっててやめられない\n同じ人はリプ欄へ👇',
  },
];

// ─── 6. レビュー風 ─────────────────────────────────────────────────────────────
const REVIEW_TEMPLATES = [
  {
    id: 'review-1',
    text: '🔞実際に見た感想を書きます\n\n{actress}「{shortTitle}」\n\n・雰囲気がいい\n・テンポがちょうどいい\n・最後まで飽きなかった\n\nレビュー{reviewCount}件・{reviewAvg}点、伊達じゃなかった\n詳細はリプ欄へ👇',
  },
  {
    id: 'review-2',
    text: '🔞正直なレビューを書きます\n\n{actress}「{shortTitle}」\n\n期待してなかったぶん、良い意味で裏切られた\nレビュー平均{reviewAvg}点の理由、見ればわかります\n\nリプ欄にリンク置いてます👇',
  },
  {
    id: 'review-3',
    text: '🔞3つだけ感想を言わせてください\n\n{actress}「{shortTitle}」\n①存在感がある\n②クオリティが安定してる\n③{reviewCount}件のレビューが信頼できる\n\n詳しくはリプ欄へ👇',
  },
  {
    id: 'review-4',
    text: '🔞これ見て一番思ったこと\n\n{actress}「{shortTitle}」\n⭐{reviewAvg}点\n\n「この点数、甘くない」と感じた\nレビュー{reviewCount}件の評価を実感できる作品\n\nリプ欄でどうぞ👇',
  },
  {
    id: 'review-5',
    text: '🔞リピートしてしまいました\n\n{actress}「{shortTitle}」\nレビュー{reviewCount}件・{reviewAvg}点\n\n一度見ただけでは終わらないタイプの作品でした\n気になる方はリプ欄へ👇',
  },
];

// ─── 7. 比較・おすすめ風 ──────────────────────────────────────────────────────
const COMPARE_TEMPLATES = [
  {
    id: 'compare-1',
    text: '🔞いろいろ見た中で一番良かったのはこれ\n\n{actress}「{shortTitle}」\n\n同じジャンルの作品と比べても\nレビュー{reviewAvg}点({reviewCount}件)は頭一つ抜けてる\n\nリプ欄へ👇',
  },
  {
    id: 'compare-2',
    text: '🔞同じジャンルを探している人に教えたい\n\n{actress}「{shortTitle}」\n\nクオリティ、テンポ、満足度\n全部において上位だと思う\n\nレビュー{reviewCount}件・{reviewAvg}点\nリプ欄でどうぞ👇',
  },
  {
    id: 'compare-3',
    text: '🔞どれ見るか迷ってる人はこれにしてください\n\n{actress}「{shortTitle}」\n⭐{reviewAvg}点({reviewCount}件)\n\n何本か見た上でのおすすめです\nリプ欄のリンクから👇',
  },
  {
    id: 'compare-4',
    text: '🔞こういう選び方をしています\n\nレビュー件数・平均点・内容、全部見る\nその上で今一番おすすめなのが\n\n{actress}「{shortTitle}」({reviewAvg}点/{reviewCount}件)\n\n同じ選び方の人はリプ欄へ👇',
  },
];

// ─── テンプレートプール（全カテゴリ統合）──────────────────────────────────────

type TemplateEntry = { id: string; text: string; category: TemplateCategory };

const ALL_TEMPLATES: TemplateEntry[] = [
  ...FRIEND_TEMPLATES.map(t => ({ ...t, category: 'friend' as TemplateCategory })),
  ...PROMO_TEMPLATES.map(t => ({ ...t, category: 'promo' as TemplateCategory })),
  ...SALE_TEMPLATES.map(t => ({ ...t, category: 'sale' as TemplateCategory })),
  ...RANKING_TEMPLATES.map(t => ({ ...t, category: 'ranking' as TemplateCategory })),
  ...NIGHT_TEMPLATES.map(t => ({ ...t, category: 'night' as TemplateCategory })),
  ...REVIEW_TEMPLATES.map(t => ({ ...t, category: 'review' as TemplateCategory })),
  ...COMPARE_TEMPLATES.map(t => ({ ...t, category: 'compare' as TemplateCategory })),
];

// カテゴリ別プール
const CATEGORY_POOLS: Record<TemplateCategory, TemplateEntry[]> = {
  friend: FRIEND_TEMPLATES.map(t => ({ ...t, category: 'friend' })),
  promo: PROMO_TEMPLATES.map(t => ({ ...t, category: 'promo' })),
  sale: SALE_TEMPLATES.map(t => ({ ...t, category: 'sale' })),
  ranking: RANKING_TEMPLATES.map(t => ({ ...t, category: 'ranking' })),
  night: NIGHT_TEMPLATES.map(t => ({ ...t, category: 'night' })),
  review: REVIEW_TEMPLATES.map(t => ({ ...t, category: 'review' })),
  compare: COMPARE_TEMPLATES.map(t => ({ ...t, category: 'compare' })),
};

// タイプ→カテゴリのマッピング（既存のpostタイプと対応）
const TYPE_TO_CATEGORIES: Record<string, TemplateCategory[]> = {
  amateur:  ['friend', 'review', 'night', 'compare'],
  rank:     ['ranking', 'compare', 'promo'],
  sale:     ['sale', 'promo', 'friend'],
  buzz:     ['promo', 'ranking', 'compare'],
  random:   ['friend', 'night', 'review', 'compare'],
  myfans:   ['friend', 'night', 'promo'],
};

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (t, [k, v]) => t.replace(new RegExp(`\\{${k}\\}`, 'g'), v),
    template,
  );
}

function shortTitle(title: string, maxLen = 22): string {
  return title.length > maxLen ? title.slice(0, maxLen) + '…' : title;
}

// ─── メイン公開関数 ──────────────────────────────────────────────────────────

/**
 * FANZAアイテムとpostタイプからテンプレートを選んでテキストを生成する。
 * templateType（night-3など）とtemplateCategoryも一緒に返す。
 */
export function pickFanzaTemplate(
  item: any,
  postType: string,
  preferCategory?: TemplateCategory,
): TemplateResult {
  // 夜21〜翌4時はnightカテゴリを優先
  const jstHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })).getHours();
  const isNightTime = jstHour >= 21 || jstHour <= 4;

  let pool: TemplateEntry[];
  if (preferCategory) {
    pool = CATEGORY_POOLS[preferCategory] ?? ALL_TEMPLATES;
  } else if (isNightTime && Math.random() < 0.4) {
    pool = CATEGORY_POOLS.night;
  } else {
    const categories = TYPE_TO_CATEGORIES[postType] ?? Object.keys(CATEGORY_POOLS) as TemplateCategory[];
    const selectedCategory = pickRandom(categories);
    pool = CATEGORY_POOLS[selectedCategory];
  }

  const entry = pickRandom(pool);

  const reviewAvg  = item?.review?.average  ? String(parseFloat(item.review.average).toFixed(1)) : '4.0';
  const reviewCount = item?.review?.count   ? String(item.review.count) : '50';
  const actress    = (item?.iteminfo?.actress ?? item?.actress ?? [])
    .map((a: any) => typeof a === 'string' ? a : a?.name ?? '')
    .filter(Boolean)[0] ?? '女優';
  const genre      = (item?.iteminfo?.genre ?? item?.genre ?? [])
    .map((g: any) => typeof g === 'string' ? g : g?.name ?? '')
    .filter(Boolean)[0] ?? '';

  const text = fillTemplate(entry.text, {
    actress,
    shortTitle: shortTitle(item?.title ?? '作品'),
    reviewAvg,
    reviewCount,
    genre,
  });

  return { text, templateType: entry.id, templateCategory: entry.category };
}

/**
 * カテゴリを明示してテンプレートを取得する（UI/テスト用）
 */
export function pickTemplateByCategory(
  item: any,
  category: TemplateCategory,
): TemplateResult {
  return pickFanzaTemplate(item, 'random', category);
}

export { ALL_TEMPLATES, CATEGORY_POOLS };
