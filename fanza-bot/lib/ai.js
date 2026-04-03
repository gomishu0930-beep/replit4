import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TYPE_HINT = {
  rank: 'ランキング上位の大人気作品',
  sale: 'セール中でお得に楽しめる作品',
  buzz: 'レビュー高評価・話題沸騰中の作品',
  random: '隠れた名作・通好みのおすすめ作品',
  new: '新着・発売直後の注目作品',
};

function formatTopPatterns(patterns) {
  if (!patterns.length) return '';
  const lines = patterns.map((p, i) => {
    const m = p.metrics;
    const score = `❤${m.like_count ?? 0} 🔁${m.retweet_count ?? 0} 🔖${m.bookmark_count ?? 0}`;
    return `${i + 1}. [${score}]\n${p.text}`;
  });
  return `\n\n【参考：過去に反応が良かった投稿パターン（文体・構成を参考にする）】\n${lines.join('\n\n')}`;
}

export async function generateTweetText(item, type, topPatterns = []) {
  const actress = item.actress?.map((a) => a.name).join('・') || '（非公開）';
  const genres = item.genre?.slice(0, 5).map((g) => g.name).join(' ') || '';
  const review = item.review?.count
    ? `レビュー${item.review.count}件 / 平均${item.review.average}点`
    : '';
  const typeHint = TYPE_HINT[type] || '';
  const patternSection = formatTopPatterns(topPatterns);

  const prompt = `あなたはFANZA（成人向け動画）のアフィリエイト投稿を作成するプロです。

【作品情報】
タイトル: ${item.title}
出演: ${actress}
ジャンル: ${genres}
${review}
紹介タイプ: ${typeHint}
${patternSection}

【投稿ルール】
- 文字数: 120〜200文字（厳守）
- リンクは別リプライで送るので本文には含めない
- センシティブさを示唆しつつ、露骨すぎる表現は避ける（X の規約内）
- 「🔞」を冒頭か末尾に必ず入れる
- 関連ハッシュタグを2〜4個（#FANZA か #fanza を必ず含める）
- 絵文字を効果的に使い、購買意欲を高める
- 参考パターンがある場合、反応が良かった文体や構成を活かす

ツイート本文のみ返してください（説明・前置き不要）。`;

  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.92,
    max_tokens: 350,
  });

  return res.choices[0].message.content.trim();
}
