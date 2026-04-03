import 'dotenv/config';

const API_BASE = 'https://api.dmm.com/affiliate/v3/ItemList';

async function fetchItems(extra = {}) {
  const params = new URLSearchParams({
    api_id: process.env.DMM_API_ID,
    affiliate_id: process.env.DMM_AFFILIATE_ID,
    site: 'FANZA',
    service: 'digital',
    floor: 'videoa',
    hits: '30',
    output: 'json',
    ...extra,
  });

  const res = await fetch(`${API_BASE}?${params}`);
  const data = await res.json();

  if (data?.result?.status !== 200) {
    throw new Error(`FANZA API error: ${JSON.stringify(data?.result)}`);
  }

  return data.result.items ?? [];
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function pickN(items, n) {
  return shuffle(items).slice(0, n);
}

// 12:00 ランキング
export async function getRankingItems(count = 3) {
  const items = await fetchItems({ sort: 'rank' });
  return pickN(items, count);
}

// 15:00 / 23:00 セール品
export async function getSaleItems(count = 3) {
  const items = await fetchItems({ sort: 'rank', article: 'campaign' });
  return pickN(items, count);
}

// 18:00 バズ（レビュー高評価・件数多い作品）
export async function getBuzzItems(count = 3) {
  const items = await fetchItems({ sort: 'review', hits: '50' });
  const filtered = items.filter(
    (i) =>
      (i.review?.count ?? 0) >= 15 &&
      parseFloat(i.review?.average ?? '0') >= 4.5,
  );
  return pickN(filtered.length >= count ? filtered : items, count);
}

// 21:00 ランダム（毎回違うページ・ソートを使う）
export async function getRandomItems(count = 3) {
  const sorts = ['rank', 'date', 'review'];
  const sort = sorts[Math.floor(Math.random() * sorts.length)];
  const offset = Math.floor(Math.random() * 80) + 1;
  const items = await fetchItems({ sort, offset: String(offset) });
  return pickN(items, count);
}

/**
 * アイテムからサンプル画像 URL を最大4枚取得する
 * 足りない場合はメイン画像で補完
 */
export function getSampleImages(item) {
  const samples = item.sampleImageURL?.sample_l?.image ?? [];
  const main = item.imageURL?.large ?? item.imageURL?.list ?? null;

  const pool = [...samples];
  while (pool.length < 4 && main) pool.push(main);

  return pool.slice(0, 4);
}
