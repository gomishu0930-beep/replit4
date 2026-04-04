import { getRecentlyPostedIds } from './storage.js';

const API_BASE = 'https://api.dmm.com/affiliate/v3/ItemList';

export async function fetchItems(extra: Record<string, string> = {}): Promise<any[]> {
  const params = new URLSearchParams({
    api_id: process.env.DMM_API_ID ?? '',
    affiliate_id: process.env.DMM_AFFILIATE_ID ?? '',
    site: 'FANZA',
    service: 'digital',
    floor: 'videoa',
    hits: '100',
    output: 'json',
    ...extra,
  });

  const res = await fetch(`${API_BASE}?${params}`);
  const data = (await res.json()) as any;

  if (data?.result?.status !== 200) {
    throw new Error(`FANZA API error: ${JSON.stringify(data?.result)}`);
  }

  return data.result.items ?? [];
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

// 重複を除いてN件選ぶ（投稿済みIDをスキップ）
function pickNUnique(items: any[], n: number): any[] {
  const postedIds = getRecentlyPostedIds(30);
  const fresh = items.filter((i) => !postedIds.has(i.content_id));
  // フレッシュ作品が足りなければ既投稿からも補充
  const pool = fresh.length >= n ? fresh : [...fresh, ...items.filter((i) => postedIds.has(i.content_id))];
  return shuffle(pool).slice(0, n);
}

function randomOffset(max = 300): string {
  return String(Math.floor(Math.random() * max) + 1);
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── 素人系キーワードローテーション（ひかりさん型の幅広い素人作品）─────────
const AMATEUR_KEYWORDS = [
  '素人', '素人ナンパ', '素人個撮', '素人エステ', '素人ハメ撮り',
  '素人妻', '素人大学生', '素人OL', '素人ギャル', '素人美少女',
  '初撮り 素人', '本物素人', '一般女性',
];

// ─── ジャンル別キーワード（おすすめ度高コンテンツ用）─────────────────────
const GENRE_KEYWORDS = [
  '巨乳', '人妻', '美少女', 'ギャル', 'OL', 'ナンパ',
  '中出し', '単体作品', 'ハイビジョン', '美乳',
];

// ─── 公開API関数 ─────────────────────────────────────────────────────────────

// 素人系：ひかりさん型の幅広い素人作品（キーワードローテーション＋offset）
export async function getAmateurItems(count = 2) {
  const keyword = pickRandom(AMATEUR_KEYWORDS);
  const sorts = ['rank', 'review', 'date'];
  const sort = pickRandom(sorts);
  const offset = randomOffset(150);
  console.log(`  🔍 素人検索: keyword="${keyword}" sort=${sort} offset=${offset}`);
  const items = await fetchItems({ keyword, sort, offset });
  return pickNUnique(items, count);
}

// バズ作品：レビュー数×評価で選出、offsetで毎回違う池から
export async function getBuzzItems(count = 2) {
  const offset = randomOffset(200);
  console.log(`  🔍 バズ検索: sort=review offset=${offset}`);
  const items = await fetchItems({ sort: 'review', offset });
  const filtered = items.filter(
    (i) => (i.review?.count ?? 0) >= 20 && parseFloat(i.review?.average ?? '0') >= 4.5,
  );
  return pickNUnique(filtered.length >= count ? filtered : items, count);
}

// おすすめ度高：評価4.7以上＋レビュー30件以上、ジャンルローテーション
export async function getHighRatedItems(count = 2) {
  const keyword = pickRandom(GENRE_KEYWORDS);
  const offset = randomOffset(300);
  console.log(`  🔍 高評価検索: keyword="${keyword}" offset=${offset}`);
  const items = await fetchItems({ sort: 'review', keyword, offset });
  const filtered = items.filter(
    (i) => (i.review?.count ?? 0) >= 30 && parseFloat(i.review?.average ?? '0') >= 4.7,
  );
  return pickNUnique(filtered.length >= count ? filtered : items, count);
}

// ランキング上位：offsetでローテーション
export async function getRankingItems(count = 2) {
  const offset = randomOffset(100);
  console.log(`  🔍 ランキング検索: offset=${offset}`);
  const items = await fetchItems({ sort: 'rank', offset });
  return pickNUnique(items, count);
}

// セール品
export async function getSaleItems(count = 2) {
  const offset = randomOffset(50);
  const items = await fetchItems({ sort: 'rank', article: 'campaign', offset });
  return pickNUnique(items, count);
}

// ランダム
export async function getRandomItems(count = 2) {
  const sorts = ['rank', 'date', 'review'];
  const sort = pickRandom(sorts);
  const offset = randomOffset(200);
  const items = await fetchItems({ sort, offset });
  return pickNUnique(items, count);
}

// キーワード検索（手動トリガー用）
export async function getKeywordItems(keyword: string, count = 1) {
  const items = await fetchItems({ keyword, sort: 'rank', hits: '20' });
  return shuffle(items).slice(0, count);
}

// 商品ID直接指定
export async function getItemById(cid: string): Promise<any | null> {
  const items = await fetchItems({ cid });
  return items[0] ?? null;
}

// サンプル画像取得（サンプル1枚目：女優の顔が映るプロモーションカット）
export function getSampleImages(item: any): string[] {
  const samples: string[] = item.sampleImageURL?.sample_l?.image ?? [];
  const selected = samples[0] ?? null;
  return selected ? [selected] : [];
}
