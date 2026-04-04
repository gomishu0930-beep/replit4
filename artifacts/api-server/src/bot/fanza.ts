const API_BASE = 'https://api.dmm.com/affiliate/v3/ItemList';

async function fetchItems(extra: Record<string, string> = {}): Promise<any[]> {
  const params = new URLSearchParams({
    api_id: process.env.DMM_API_ID ?? '',
    affiliate_id: process.env.DMM_AFFILIATE_ID ?? '',
    site: 'FANZA',
    service: 'digital',
    floor: 'videoa',
    hits: '30',
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

function pickN<T>(items: T[], n: number): T[] {
  return shuffle(items).slice(0, n);
}

export async function getRankingItems(count = 3) {
  const items = await fetchItems({ sort: 'rank' });
  return pickN(items, count);
}

export async function getSaleItems(count = 3) {
  const items = await fetchItems({ sort: 'rank', article: 'campaign' });
  return pickN(items, count);
}

export async function getBuzzItems(count = 3) {
  const items = await fetchItems({ sort: 'review', hits: '50' });
  const filtered = items.filter(
    (i) =>
      (i.review?.count ?? 0) >= 15 &&
      parseFloat(i.review?.average ?? '0') >= 4.5,
  );
  return pickN(filtered.length >= count ? filtered : items, count);
}

export async function getRandomItems(count = 3) {
  const sorts = ['rank', 'date', 'review'];
  const sort = sorts[Math.floor(Math.random() * sorts.length)];
  const offset = Math.floor(Math.random() * 80) + 1;
  const items = await fetchItems({ sort, offset: String(offset) });
  return pickN(items, count);
}

export async function getAmateurItems(count = 3) {
  const sorts = ['rank', 'review', 'date'];
  const sort = sorts[Math.floor(Math.random() * sorts.length)];
  const items = await fetchItems({ sort, keyword: '素人', hits: '50' });
  return pickN(items, count);
}

export async function getKeywordItems(keyword: string, count = 1) {
  const items = await fetchItems({ keyword, sort: 'rank', hits: '20' });
  return pickN(items, count);
}

export async function getItemById(cid: string): Promise<any | null> {
  const items = await fetchItems({ cid });
  return items[0] ?? null;
}

export function getSampleImages(item: any): string[] {
  const samples: string[] = item.sampleImageURL?.sample_l?.image ?? [];
  const main: string | null = item.imageURL?.large ?? item.imageURL?.list ?? null;

  const pool = [...samples];
  while (pool.length < 4 && main) pool.push(main);

  return pool.slice(0, 4);
}
