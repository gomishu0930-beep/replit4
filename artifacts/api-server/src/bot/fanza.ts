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

// ─── 包括的スコア計算（ベイズ平均 × 人気度ウェイト）─────────────────────────
//
// 単純な星評価だけでなく、レビュー数・ランキングを加味した
// 信頼度の高い総合評価を算出する。
//
// 例:
//   星4.9 × レビュー3件   → composite ≈ 3.3  ← 過大評価を抑制
//   星4.7 × レビュー200件 → composite ≈ 5.0  ← 真の人気作を優先
//
function compositeScore(item: any): number {
  const avg = parseFloat(item.review?.average ?? '0');
  const count = item.review?.count ?? 0;
  if (avg === 0 || count === 0) return 0;

  // ベイズ平均: 事前平均 m=4.0、基準レビュー数 C=50
  // 少ないレビュー数の高評価を割り引き、多いレビュー数の評価を信頼する
  const C = 50;
  const m = 4.0;
  const bayesianAvg = (C * m + count * avg) / (C + count);

  // 人気度ウェイト: レビュー数の対数スケール（購入数・閲覧数の代理指標）
  const popularityWeight = Math.log10(count + 1);

  return bayesianAvg * popularityWeight;
}

// ─── FANZA素人フロア専用APIリクエスト ────────────────────────────────────────
// フロアAPI確認済み: floor=videoc / floorId=44 / floorName=素人（"ひかりさん"等）
async function fetchAmaItems(extra: Record<string, string> = {}): Promise<any[]> {
  const params = new URLSearchParams({
    api_id: process.env.DMM_API_ID ?? '',
    affiliate_id: process.env.DMM_AFFILIATE_ID ?? '',
    site: 'FANZA',
    service: 'digital',
    floor: 'videoc',     // FANZA素人フロア（"ひかりさん"等）正式コード
    hits: '100',
    output: 'json',
    ...extra,
  });

  const res = await fetch(`${API_BASE}?${params}`);
  const data = (await res.json()) as any;

  if (data?.result?.status !== 200) {
    throw new Error(`FANZA 素人API error: ${JSON.stringify(data?.result)}`);
  }

  return data.result.items ?? [];
}

// ─── FANZA素人系キーワード（floor=videoc フォールバック用）────────────────────
//
// 主取得は floor=videoc（FANZA素人フロア）から直接取得。
// API障害・件数不足時のフォールバックとして、videoa フロアで
// 素人系キーワード検索を行う。

const AMATEUR_KEYWORDS = [
  // FANZA素人系（個人投稿スタイル）
  'FANZA素人', '素人投稿', '素人個撮', '素人ハメ撮り自撮り',
  '素人ナンパ 中出し', '本物素人 初撮り',
  // 属性系（FANZA素人に多いプロファイル）
  '素人 大学生 中出し', '素人 OL 個撮', '素人 人妻 自撮り',
  '素人 ギャル ナンパ', '素人 美少女 初撮り', '素人 巨乳 中出し',
  // 素人らしさを強調するワード
  '一般人 撮影', '素人娘', '隣の女の子', '普通の女の子',
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

// 素人系 — FANZA素人フロア（floor=ama）を優先取得
// 「ひかりさん」等のFANZA素人コンテンツに特化
export async function getAmateurItems(count = 2) {
  const sorts = ['rank', 'review', 'date'];
  const sort = pickRandom(sorts);
  const offset = randomOffset(100);

  // ① FANZA素人専用フロアから取得（最優先）
  try {
    console.log(`  🔍 FANZA素人フロア検索: floor=videoc sort=${sort} offset=${offset}`);
    const amaItems = await fetchAmaItems({ sort, offset });
    if (amaItems.length >= count) {
      console.log(`  ✅ FANZA素人フロアから ${amaItems.length}件取得`);
      return pickNUnique(amaItems, count);
    }
    console.warn(`  ⚠ FANZA素人フロア: 件数不足 (${amaItems.length}件) → キーワード補完`);
  } catch (e: any) {
    console.warn(`  ⚠ FANZA素人フロア失敗: ${e.message} → キーワードフォールバック`);
  }

  // ② キーワード検索フォールバック（videoa フロア）
  const keyword = pickRandom(AMATEUR_KEYWORDS);
  console.log(`  🔀 素人フォールバック: keyword="${keyword}" sort=${sort}`);
  const items = await fetchItems({ keyword, sort, offset: randomOffset(150) });
  return pickNUnique(items, count);
}

// バズ作品 — 急上昇・高反応作品を包括スコアで選出
export async function getBuzzItems(count = 2) {
  const offset = randomOffset(200);
  console.log(`  🔍 バズ検索: sort=review offset=${offset}`);
  const items = await fetchItems({ sort: 'review', offset });

  // 最低条件: レビュー20件以上 & 4.5点以上
  const filtered = items.filter(
    (i) => (i.review?.count ?? 0) >= 20 && parseFloat(i.review?.average ?? '0') >= 4.5,
  );
  const pool = filtered.length >= count ? filtered : items;

  // 包括スコアで上位を選ぶ
  const scored = pool
    .map((item) => ({ item, score: compositeScore(item) }))
    .sort((a, b) => b.score - a.score);

  return pickNUnique(scored.slice(0, 20).map((s) => s.item), count);
}

// 高評価 — 包括的スコアリングで選出
// 星評価単体ではなく「ベイズ平均 × 人気度」で本当に支持されている作品を選ぶ
export async function getHighRatedItems(count = 2) {
  const keyword = pickRandom(GENRE_KEYWORDS);
  console.log(`  🔍 高評価検索: keyword="${keyword}" (rank + review の両軸取得)`);

  // rank順・review順の両方から並行取得して多様なプールを作る
  const [rankItems, reviewItems] = await Promise.all([
    fetchItems({ sort: 'rank',   keyword, offset: randomOffset(200) }),
    fetchItems({ sort: 'review', keyword, offset: randomOffset(200) }),
  ]);

  // 統合・content_idで重複排除
  const allMap = new Map<string, any>();
  for (const item of [...rankItems, ...reviewItems]) {
    if (!allMap.has(item.content_id)) allMap.set(item.content_id, item);
  }
  const all = [...allMap.values()];

  // 最低ラインのフィルター（レビュー10件以上）
  const filtered = all.filter((i) => (i.review?.count ?? 0) >= 10);
  const pool = filtered.length >= count ? filtered : all;

  // 包括スコアで降順ソート → 上位20件からランダム選択（偏り防止）
  const scored = pool
    .map((item) => ({ item, score: compositeScore(item) }))
    .sort((a, b) => b.score - a.score);

  // スコア上位5件をデバッグ表示
  scored.slice(0, 5).forEach((s) => {
    const avg = s.item.review?.average ?? '?';
    const cnt = s.item.review?.count ?? 0;
    console.log(`    📊 composite=${s.score.toFixed(2)} | ★${avg} × ${cnt}件 | ${s.item.title?.slice(0, 30)}`);
  });

  return pickNUnique(scored.slice(0, 20).map((s) => s.item), count);
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
