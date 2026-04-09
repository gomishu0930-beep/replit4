/**
 * celebrity.ts
 * 芸能人×似ている女優 マッピング＋最高エンゲージメント時間帯検出
 * v2: GPT-4o-mini Vision によるジャケット画像類似度スコアリング追加
 */
import OpenAI from 'openai';
import { getAllPosts } from './storage.js';
import { fetchItems } from './fanza.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── 型定義 ──────────────────────────────────────────────────────────────────

export interface CelebrityMapping {
  celebrity: string;         // 芸能人名
  hooks: string[];           // フックバリエーション（本文1行目）
  keyword: string;           // FANZA検索キーワード（似ている特徴）
  sort: string;              // FANZA検索ソート
  introLines: string[];      // リプライ①の紹介文バリエーション
}

// ─── 芸能人 × 似ている女優キーワード マッピング ──────────────────────────────

export const CELEBRITY_MAPPINGS: CelebrityMapping[] = [
  {
    celebrity: '橋本環奈',
    hooks: [
      '橋本環奈に激似の子を発見してしまった…',
      '橋本環奈に似すぎてて二度見した',
      '橋本環奈リスペクターに見てほしい子がいる',
    ],
    keyword: '美少女 清楚 笑顔',
    sort: 'review',
    introLines: [
      '橋本環奈に似ているって話題の子がこちら💕\nその笑顔と透明感がヤバすぎる…',
      'この笑顔、橋本環奈に似てると思いませんか？\n天然の可愛さが詰まった一本です',
    ],
  },
  {
    celebrity: '浜辺美波',
    hooks: [
      '浜辺美波にそっくりすぎるAV女優がいた',
      '浜辺美波似の子がいると聞いて確かめた結果',
      '浜辺美波リスペクターは絶対見て',
    ],
    keyword: '清楚 透明感 美少女',
    sort: 'review',
    introLines: [
      '浜辺美波系のあの清楚感…この子そっくりなんです💕\nパッと見で気づいた人は相当目が肥えてる',
      'この透明感と清楚さ、浜辺美波に似てると思う人続出中✨',
    ],
  },
  {
    celebrity: '新垣結衣',
    hooks: [
      '新垣結衣に似てる子が本当にいた件',
      'ガッキーに似た子がいると聞いて確かめてみた',
      '新垣結衣系の清楚美人を発見してしまった',
    ],
    keyword: '美脚 スレンダー 清楚',
    sort: 'review',
    introLines: [
      'ガッキーに似てるって言われてる子がこちら💕\nそのスタイルと笑顔が本当によく似てる…',
      'この子のスタイルと清楚感、新垣結衣にそっくりで話題になってます✨',
    ],
  },
  {
    celebrity: '石原さとみ',
    hooks: [
      '石原さとみ似の色気がヤバすぎる子を見つけた',
      '石原さとみに似てると話題の子がいた',
      '石原さとみ系の美人、こんな子いるんだ…',
    ],
    keyword: '美人 色気 単体',
    sort: 'review',
    introLines: [
      '石原さとみ系の大人の色気がある子です💕\nその美しさが作品にも出てる…',
      'この目の大きさと色気、石原さとみに似てると思いませんか？✨',
    ],
  },
  {
    celebrity: '広瀬すず',
    hooks: [
      '広瀬すずに激似のフレッシュな子がいた',
      '広瀬すず似のさわやか美少女を発見した',
      '広瀬すずリスペクターに見せたい子がいる',
    ],
    keyword: 'さわやか フレッシュ 美少女',
    sort: 'review',
    introLines: [
      '広瀬すず系のさわやかさがある子です💕\nそのフレッシュさが全てを物語ってる',
      'この子のさわやかな笑顔、広瀬すずに似てるって話題なんです✨',
    ],
  },
  {
    celebrity: '今田美桜',
    hooks: [
      '今田美桜に似た小柄な美少女を発見した',
      '今田美桜系のかわいさがある子がいた',
      '今田美桜似の子ってこんなにかわいいの…',
    ],
    keyword: '小柄 美少女 かわいい',
    sort: 'review',
    introLines: [
      '今田美桜に似ているって言われてる子がこちら💕\nその小柄さとかわいさが最高です',
      'この小柄さとかわいい顔、今田美桜に似てると思う人多数✨',
    ],
  },
  {
    celebrity: '有村架純',
    hooks: [
      '有村架純に激似の清楚系女優がいた',
      '有村架純似の子がいると聞いて見に行った',
      '有村架純系の清楚な子、存在したんだ…',
    ],
    keyword: '清楚 単体作品 美人',
    sort: 'review',
    introLines: [
      '有村架純に似てるって話題の子がこちら💕\nその清楚さと笑顔が本当にそっくり',
      'この清楚感と笑顔、有村架純に似てると思いませんか？✨',
    ],
  },
  {
    celebrity: '吉岡里帆',
    hooks: [
      '吉岡里帆に似た童顔美人を見つけてしまった',
      '吉岡里帆似の子がいると聞いて確かめた結果',
      '吉岡里帆系の童顔かわいい子がいた',
    ],
    keyword: '童顔 美少女 巨乳',
    sort: 'review',
    introLines: [
      '吉岡里帆系の童顔×スタイル抜群の子です💕\nそのギャップがたまらない…',
      'この童顔と笑顔、吉岡里帆に似てると話題になってます✨',
    ],
  },
  {
    celebrity: '深田恭子',
    hooks: [
      '深田恭子に似た美熟女を発見してしまった',
      '深田恭子系のスタイル抜群な人がいた',
      '深田恭子に似てるって言われてる人がいる',
    ],
    keyword: '美熟女 グラマラス スタイル',
    sort: 'review',
    introLines: [
      '深田恭子に似てると話題の美熟女さんです💕\nそのスタイルと色気が本物…',
      'この色気とスタイル、深田恭子に似てると思いませんか？✨',
    ],
  },
  {
    celebrity: '永野芽郁',
    hooks: [
      '永野芽郁に似た天然かわいい子を発見した',
      '永野芽郁似の子がいると聞いて見てみた',
      '永野芽郁系の自然体な子、こんなにかわいいの',
    ],
    keyword: '天然 かわいい 素人',
    sort: 'review',
    introLines: [
      '永野芽郁に似てる天然系の子がこちら💕\nその自然体な感じがたまらない',
      'この自然体なかわいさ、永野芽郁に似てる子がいるとは思ってなかった✨',
    ],
  },
];

// ─── ランダム選択 ─────────────────────────────────────────────────────────────

let lastCelebrityIndex = -1;

export function pickCelebrity(): CelebrityMapping {
  // 前回と被らないようにローテーション
  let idx: number;
  do {
    idx = Math.floor(Math.random() * CELEBRITY_MAPPINGS.length);
  } while (idx === lastCelebrityIndex && CELEBRITY_MAPPINGS.length > 1);
  lastCelebrityIndex = idx;
  return CELEBRITY_MAPPINGS[idx];
}

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── 最高エンゲージメント時間帯の検出 ────────────────────────────────────────

// 既存スロットと重複しない時間帯
const EXISTING_SLOT_HOURS = new Set([9, 12, 18, 21, 23]);
const DEFAULT_BEST_HOUR = 20; // データ不足時のデフォルト

export function getBestPostingHour(): number {
  const posts = getAllPosts().filter((p) => p.metrics);
  if (posts.length < 5) {
    console.log(`  📊 エンゲージメントデータ不足 (${posts.length}件) → デフォルト ${DEFAULT_BEST_HOUR}:00 JST を使用`);
    return DEFAULT_BEST_HOUR;
  }

  // JSTの時間帯別にスコアを集計
  const hourStats: Record<number, { total: number; count: number }> = {};
  for (const post of posts) {
    const m = post.metrics!;
    const score = (m.like_count || 0) + (m.retweet_count || 0) * 3
                + (m.bookmark_count || 0) * 2 + (m.reply_count || 0);
    const jstHour = (new Date(post.postedAt).getUTCHours() + 9) % 24;
    if (!hourStats[jstHour]) hourStats[jstHour] = { total: 0, count: 0 };
    hourStats[jstHour].total += score;
    hourStats[jstHour].count++;
  }

  // 既存スロットと被らない時間帯のみで最高スコアを選ぶ
  let bestHour = DEFAULT_BEST_HOUR;
  let bestAvg = -1;

  for (const [hourStr, stat] of Object.entries(hourStats)) {
    const hour = Number(hourStr);
    if (EXISTING_SLOT_HOURS.has(hour)) continue;
    if (stat.count < 2) continue; // データが2件以上ある時間帯のみ
    const avg = stat.total / stat.count;
    if (avg > bestAvg) {
      bestAvg = avg;
      bestHour = hour;
    }
  }

  // バグA修正: ボット自身のリプライ（reply_count=1）だけで決まった場合はデフォルトに戻す
  // 自己リプライが 1件あると score=1 になるため、全ポストのスコアが均等に 1.0 になり
  // 投稿件数が多い時間帯（≥2件）が誤って「最良」と判定されてしまう問題を防ぐ
  if (bestAvg <= 1.0) {
    console.log(`  📊 有意なエンゲージメントデータなし (bestAvg=${bestAvg.toFixed(1)}) → デフォルト ${DEFAULT_BEST_HOUR}:00 JST を使用`);
    return DEFAULT_BEST_HOUR;
  }

  console.log(`  📊 最高エンゲージメント時間帯: ${bestHour}:00 JST (avg score: ${bestAvg.toFixed(1)})`);
  return bestHour;
}

// ─── GPT-4o-mini Vision による芸能人類似度スコアリング ────────────────────────

/**
 * FANZA作品のジャケット画像を GPT-4o-mini Vision に渡し、
 * 指定芸能人への類似度を 1〜10 で返す。
 * 画像なし・APIエラー時は null を返す。
 */
async function scoreJacketSimilarity(
  celebrity: string,
  jacketUrl: string,
): Promise<number | null> {
  if (!jacketUrl) return null;
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 10,
      messages: [
        {
          role: 'system',
          content:
            'あなたは日本の芸能人とAV女優の外見を比較する評価AIです。' +
            '画像に写っている女性の顔・輪郭・雰囲気を分析し、指定された芸能人への類似度を数値のみで回答してください。',
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: jacketUrl, detail: 'low' },
            },
            {
              type: 'text',
              text:
                `この画像に写っている女性は日本の芸能人「${celebrity}」に顔が似ていますか？` +
                `顔の輪郭・目・鼻・口・全体の雰囲気を基準に1〜10で評価してください。` +
                `10が最も似ている。数字1文字だけ回答してください。`,
            },
          ],
        },
      ],
    });
    const raw = res.choices[0]?.message?.content?.trim() ?? '';
    const score = parseInt(raw.replace(/[^0-9]/g, ''), 10);
    return isNaN(score) ? null : Math.min(10, Math.max(1, score));
  } catch (e: any) {
    console.warn(`  ⚠ [Vision] スコアリングエラー: ${e.message}`);
    return null;
  }
}

/**
 * FANZA作品リストを Vision スコア付きでソートして返す。
 * 並列で最大 MAX_SCORE_ITEMS 件をスコアリング。
 */
const MAX_SCORE_ITEMS = 12; // Vision API 呼び出し上限（コスト制御）
const MIN_ACCEPTABLE_SCORE = 4; // この点数以上を「合格」とする

/** 直近のVisionスコアリング結果（ダッシュボード表示用）*/
export interface VisionScoringResult {
  celebrity: string;
  scoredAt: string;
  scores: Array<{ actressName: string; title: string; score: number | null; jacketUrl: string }>;
  topScore: number | null;
  topActress: string;
  adopted: string;
}
let _lastVisionResult: VisionScoringResult | null = null;
export function getLastVisionScoringResult(): VisionScoringResult | null { return _lastVisionResult; }

export async function scoredCelebrityItems(
  celebrity: string,
  items: any[],
): Promise<Array<{ item: any; score: number | null }>> {
  // ジャケット画像があるものを優先して上限件数を取る
  const candidates = items
    .filter((i) => i.imageURL?.large)
    .slice(0, MAX_SCORE_ITEMS);

  // 全件を並列スコアリング
  const scored = await Promise.all(
    candidates.map(async (item) => ({
      item,
      score: await scoreJacketSimilarity(celebrity, item.imageURL.large),
    })),
  );

  // スコアなし（null）は末尾扱い
  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const best = scored[0];
  const topScore = best?.score ?? 0;
  const actressName = (item: any): string =>
    item.actress?.map((a: any) => a.name).join('・') || item.title?.slice(0, 20) || '?';

  console.log(
    `  🔍 [Vision] ${celebrity} 類似度スコアリング完了: ` +
    scored.map((s) => `${actressName(s.item)}=${s.score}`).join(' / '),
  );
  console.log(
    `  🏆 [Vision] 最高スコア: ${actressName(best?.item ?? {})} = ${topScore}点`,
  );

  // ダッシュボード表示用にキャッシュ（adoptedは呼び出し元が後で設定）
  _lastVisionResult = {
    celebrity,
    scoredAt: new Date().toISOString(),
    scores: scored.map((s) => ({
      actressName: actressName(s.item),
      title: s.item.title?.slice(0, 40) ?? '',
      score: s.score,
      jacketUrl: s.item.imageURL?.large ?? '',
    })),
    topScore,
    topActress: actressName(best?.item ?? {}),
    adopted: '',  // getCelebrityLikeItems が後で更新
  };

  return scored;
}

// ─── FANZA から似ている女優の作品を取得（Vision スコアリング付き）────────────

export async function getCelebrityLikeItems(mapping: CelebrityMapping, count = 1): Promise<any[]> {
  const items = await fetchItems({
    keyword: mapping.keyword,
    sort: mapping.sort,
    hits: '50',
  });

  // レビュー数・評価でフィルタ
  const filtered = items.filter(
    (i: any) => (i.review?.count ?? 0) >= 10 && parseFloat(i.review?.average ?? '0') >= 4.0,
  );
  const pool = filtered.length >= count ? filtered : items;

  // ── Vision スコアリングで最も似ている女優を選ぶ ─────────────────────────────
  try {
    const scored = await scoredCelebrityItems(mapping.celebrity, pool);

    // スコア MIN_ACCEPTABLE_SCORE 以上の合格アイテムを優先
    const passed = scored.filter((s) => (s.score ?? 0) >= MIN_ACCEPTABLE_SCORE);
    const getName = (item: any) =>
      item.actress?.map((a: any) => a.name).join('・') || item.title?.slice(0, 20) || '?';

    if (passed.length >= count) {
      // 上位からランダムにPickして単調さを避ける（上位3件の中からランダム）
      const topN = passed.slice(0, Math.min(3, passed.length));
      const picked = topN.sort(() => Math.random() - 0.5).slice(0, count);
      const adoptedName = picked.map(p => getName(p.item)).join('・');
      console.log(`  ✅ [Vision] 合格(${passed.length}件中${count}件採用): ${adoptedName}`);
      if (_lastVisionResult) _lastVisionResult.adopted = adoptedName;
      return picked.map((s) => s.item);
    }

    // 合格がいなければ最高スコアのアイテムを採用（フォールバック）
    if (scored.length > 0) {
      const adoptedName = getName(scored[0].item);
      console.warn(`  ⚠ [Vision] 合格アイテムなし → 最高スコア(${scored[0].score}点)を採用`);
      if (_lastVisionResult) _lastVisionResult.adopted = adoptedName;
      return [scored[0].item];
    }
  } catch (e: any) {
    console.warn(`  ⚠ [Vision] スコアリング全体エラー → 従来フィルタにフォールバック: ${e.message}`);
  }

  // Vision 完全失敗時のフォールバック（従来ロジック）
  return pool.sort(() => Math.random() - 0.5).slice(0, count);
}
