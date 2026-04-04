import { getRecentlyPostedIds } from './storage.js';
import { readJson, writeJson } from './cloudStore.js';

const API_BASE = 'https://api.dmm.com/affiliate/v3/ItemList';
const CAMPAIGN_CACHE_KEY = 'campaign-ids.json';
const CAMPAIGN_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日

// ─── コアAPIリクエスト ─────────────────────────────────────────────────────────

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
  const pool = fresh.length >= n ? fresh : [...fresh, ...items.filter((i) => postedIds.has(i.content_id))];
  return shuffle(pool).slice(0, n);
}

function randomOffset(max = 300): string {
  return String(Math.floor(Math.random() * max) + 1);
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── キャンペーンID探索・キャッシュ ──────────────────────────────────────────

interface CampaignCache {
  ids: { id: number; total: number }[];
  discoveredAt: string;
  nextSearchStart: number;
}

let _campaignCache: CampaignCache | null = null;
let _cacheLoadedAt = 0;
let _discovering = false;

async function loadCampaignCache(): Promise<CampaignCache> {
  if (_campaignCache && Date.now() - _cacheLoadedAt < 60_000) return _campaignCache;
  const cache = await readJson<CampaignCache>(CAMPAIGN_CACHE_KEY, { ids: [], discoveredAt: '', nextSearchStart: 1 });
  _campaignCache = cache;
  _cacheLoadedAt = Date.now();
  return cache;
}

async function saveCampaignCache(cache: CampaignCache) {
  _campaignCache = cache;
  _cacheLoadedAt = Date.now();
  await writeJson(CAMPAIGN_CACHE_KEY, cache);
}

// 1つのIDを検証（エラーはnullで吸収）
async function probeCampaignId(id: number): Promise<{ id: number; total: number } | null> {
  try {
    const params = new URLSearchParams({
      api_id: process.env.DMM_API_ID ?? '',
      affiliate_id: process.env.DMM_AFFILIATE_ID ?? '',
      site: 'FANZA',
      service: 'digital',
      floor: 'videoa',
      article: 'campaign',
      article_id: String(id),
      hits: '1',
      output: 'json',
    });
    const res = await fetch(`${API_BASE}?${params}`);
    const data = (await res.json()) as any;
    if (data?.result?.status === 200 && (data?.result?.total_count ?? 0) > 0) {
      return { id, total: data.result.total_count };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * キャンペーンIDを自動探索してGCSにキャッシュ。
 * バッチサイズ5、バッチ間1秒のスロットリングでレート制限を回避。
 * 既に探索済みの範囲はスキップする。
 */
export async function discoverCampaignIds(opts: { force?: boolean; maxProbe?: number } = {}): Promise<void> {
  if (_discovering) {
    console.log('  ⏭ キャンペーンID探索: 既に実行中のためスキップ');
    return;
  }
  _discovering = true;

  try {
    const cache = await loadCampaignCache();
    const now = Date.now();

    // キャッシュが新鮮かつIDがあれば強制フラグがない限りスキップ
    if (!opts.force && cache.ids.length > 0) {
      const age = now - new Date(cache.discoveredAt).getTime();
      if (age < CAMPAIGN_CACHE_TTL_MS) {
        console.log(`  ✅ キャンペーンIDキャッシュ有効: ${cache.ids.length}件 (${Math.round(age / 3600000)}h前)`);
        return;
      }
    }

    const startId = opts.force ? 1 : (cache.nextSearchStart ?? 1);
    const maxProbe = opts.maxProbe ?? 300; // 1回の探索で最大300ID
    const endId = startId + maxProbe - 1;

    console.log(`  🔍 キャンペーンID探索開始: ID ${startId}〜${endId}`);

    const found: { id: number; total: number }[] = [];
    const BATCH = 5;

    for (let i = startId; i <= endId; i += BATCH) {
      const batch = [];
      for (let j = i; j < Math.min(i + BATCH, endId + 1); j++) {
        batch.push(probeCampaignId(j));
      }
      const results = await Promise.all(batch);
      const valid = results.filter((r): r is { id: number; total: number } => r !== null);
      if (valid.length > 0) {
        valid.forEach((v) => console.log(`  🎯 campaign_id=${v.id} (${v.total}件)`));
        found.push(...valid);
      }
      await sleep(1000); // レート制限対策：1秒待機
    }

    // 既存IDと統合（重複排除・total更新）
    const existingMap = new Map(cache.ids.map((x) => [x.id, x]));
    for (const v of found) existingMap.set(v.id, v);

    const merged = [...existingMap.values()].sort((a, b) => b.total - a.total);

    const updated: CampaignCache = {
      ids: merged,
      discoveredAt: new Date().toISOString(),
      nextSearchStart: endId + 1,
    };
    await saveCampaignCache(updated);
    console.log(`  ✅ キャンペーンID探索完了: 有効 ${merged.length}件 (今回新発見 ${found.length}件)`);
  } finally {
    _discovering = false;
  }
}

// 有効なキャンペーンIDでアイテムを取得（ランダムに選ぶ）
async function fetchByCampaignId(count: number): Promise<any[]> {
  const cache = await loadCampaignCache();
  if (cache.ids.length === 0) return [];

  const cacheAge = Date.now() - new Date(cache.discoveredAt).getTime();
  if (cacheAge > CAMPAIGN_CACHE_TTL_MS) return []; // 期限切れ

  const picked = pickRandom(cache.ids);
  console.log(`  🛒 キャンペーンID ${picked.id} を使用 (${picked.total}件)`);

  try {
    const offset = randomOffset(Math.min(picked.total, 200));
    const items = await fetchItems({ article: 'campaign', article_id: String(picked.id), offset });
    return pickNUnique(items, count);
  } catch (e: any) {
    console.warn(`  ⚠ campaign_id=${picked.id} 失敗: ${e.message}`);
    return [];
  }
}

// ─── 素人系キーワードローテーション ──────────────────────────────────────────

const AMATEUR_KEYWORDS = [
  '素人', '素人ナンパ', '素人個撮', '素人エステ', '素人ハメ撮り',
  '素人妻', '素人大学生', '素人OL', '素人ギャル', '素人美少女',
  '初撮り 素人', '本物素人', '一般女性',
];

const GENRE_KEYWORDS = [
  '巨乳', '人妻', '美少女', 'ギャル', 'OL', 'ナンパ',
  '中出し', '単体作品', 'ハイビジョン', '美乳',
];

// セール関連キーワード（APIキャンペーン機能が使えない場合のフォールバック）
// ※ article=campaign は現在アクティブなIDなし → キーワードで代替
const SALE_KEYWORDS = [
  '期間限定', 'セール', 'ポイント還元', '限定価格', '初回限定',
  '独占配信', '新作特価', 'ベスト', 'パック', 'コレクション',
];

// ─── 公開API関数 ──────────────────────────────────────────────────────────────

// 素人系
export async function getAmateurItems(count = 2) {
  const keyword = pickRandom(AMATEUR_KEYWORDS);
  const sorts = ['rank', 'review', 'date'];
  const sort = pickRandom(sorts);
  const offset = randomOffset(150);
  console.log(`  🔍 素人検索: keyword="${keyword}" sort=${sort} offset=${offset}`);
  const items = await fetchItems({ keyword, sort, offset });
  return pickNUnique(items, count);
}

// バズ作品
export async function getBuzzItems(count = 2) {
  const offset = randomOffset(200);
  console.log(`  🔍 バズ検索: sort=review offset=${offset}`);
  const items = await fetchItems({ sort: 'review', offset });
  const filtered = items.filter(
    (i) => (i.review?.count ?? 0) >= 20 && parseFloat(i.review?.average ?? '0') >= 4.5,
  );
  return pickNUnique(filtered.length >= count ? filtered : items, count);
}

// 高評価
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

// ランキング上位
export async function getRankingItems(count = 2) {
  const offset = randomOffset(100);
  console.log(`  🔍 ランキング検索: offset=${offset}`);
  const items = await fetchItems({ sort: 'rank', offset });
  return pickNUnique(items, count);
}

/**
 * セール品取得（優先順位）:
 *  1. 発見済みキャンペーンIDがあればそれを使用
 *  2. なければキーワード検索にフォールバック
 */
export async function getSaleItems(count = 2) {
  // ① キャンペーンID探索済みであれば使う
  const campaignItems = await fetchByCampaignId(count);
  if (campaignItems.length >= count) {
    console.log(`  🎉 キャンペーンID経由でセール品取得: ${campaignItems.length}件`);
    return campaignItems;
  }

  // ② キーワードフォールバック
  const keyword = pickRandom(SALE_KEYWORDS);
  const offset = randomOffset(50);
  console.log(`  🔍 セール検索（キーワード）: keyword="${keyword}" offset=${offset}`);
  try {
    const items = await fetchItems({ sort: 'rank', keyword, offset });
    if (items.length > 0) return pickNUnique(items, count);
  } catch (e: any) {
    console.warn(`  ⚠ セールキーワード検索失敗: ${e.message}`);
  }

  // ③ 最終フォールバック：ランダム上位
  console.log('  🔀 セール: ランダムランキングにフォールバック');
  const fallback = await fetchItems({ sort: 'rank', offset: randomOffset(200) });
  return pickNUnique(fallback, count);
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

// サンプル画像取得
export function getSampleImages(item: any): string[] {
  const samples: string[] = item.sampleImageURL?.sample_l?.image ?? [];
  const selected = samples[0] ?? null;
  return selected ? [selected] : [];
}

// キャンペーンキャッシュ情報（API・ダッシュボード用）
export async function getCampaignCacheInfo() {
  const cache = await loadCampaignCache();
  return {
    count: cache.ids.length,
    discoveredAt: cache.discoveredAt || null,
    nextSearchStart: cache.nextSearchStart,
    topIds: cache.ids.slice(0, 10).map((x) => ({ id: x.id, total: x.total })),
    isExpired: cache.discoveredAt
      ? Date.now() - new Date(cache.discoveredAt).getTime() > CAMPAIGN_CACHE_TTL_MS
      : true,
  };
}
