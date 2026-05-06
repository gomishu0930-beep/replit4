import { getRecentlyPostedIds } from './storage.js';
import { readJson, writeJson } from './cloudStore.js';
import { getClickedProductSignals, getProductClickSignals } from './post-analytics.js';

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

// 重複を除いてスコア順を維持したままN件選ぶ。投稿作成UIと自動収益候補で使う。
function topNUnique(items: any[], n: number): any[] {
  const postedIds = getRecentlyPostedIds(30);
  const seen = new Set<string>();
  const fresh: any[] = [];
  const posted: any[] = [];
  for (const item of items) {
    const id = item?.content_id ?? item?.title;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (postedIds.has(item.content_id)) posted.push(item);
    else fresh.push(item);
  }
  return (fresh.length >= n ? fresh : [...fresh, ...posted]).slice(0, n);
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

// 有効なキャンペーンIDでアイテムを取得（品質スコア順で選ぶ）
// 複数IDを試し、良い作品（高レビュー×高評価×セール）を返す
async function fetchByCampaignId(count: number): Promise<any[]> {
  const cache = await loadCampaignCache();
  if (cache.ids.length === 0) return [];

  const cacheAge = Date.now() - new Date(cache.discoveredAt).getTime();
  if (cacheAge > CAMPAIGN_CACHE_TTL_MS) return []; // 期限切れ

  // 上位3件のキャンペーンIDを試し、全結果を品質スコアでソート
  const topIds = cache.ids.slice(0, 3);
  const allItems: any[] = [];

  for (const campaign of topIds) {
    try {
      const offset = randomOffset(Math.min(campaign.total, 200));
      const items = await fetchItems({ article: 'campaign', article_id: String(campaign.id), offset });
      console.log(`  🛒 campaign_id=${campaign.id}: ${items.length}件取得`);
      allItems.push(...items);
    } catch (e: any) {
      console.warn(`  ⚠ campaign_id=${campaign.id} 失敗: ${e.message}`);
    }
  }

  if (allItems.length === 0) return [];

  // 品質スコア順に並べ重複除外して返す（セール × 高評価 × 人気の三拍子）
  const dedupMap = new Map<string, any>();
  for (const item of allItems) dedupMap.set(item.content_id, item);
  const deduped = [...dedupMap.values()];

  const scored = topByScore(deduped, count, 10, 4.0); // レビュー10件以上・4.0点以上を優先
  console.log(`  🏆 セール品スコアトップ: ★${scored[0]?.review?.average} × ${scored[0]?.review?.count}件 「${scored[0]?.title?.slice(0, 25)}」`);
  return pickNUnique(scored, count);
}

// ─── 包括的スコア計算（ベイズ平均 × 人気度ウェイト）─────────────────────────
//
// 「良い作品」= 有名女優 × 人気（レビュー数多い）× 高評価 × セール中
//
// ベイズ平均で「レビュー数が少ない高評価」を割り引き、
// 「多くの人が購入して高く評価した = 有名女優の作品」を自然に優先する。
//
// 例:
//   星4.9 × レビュー3件   → composite ≈ 3.3  ← 過大評価を抑制
//   星4.7 × レビュー200件 → composite ≈ 5.0  ← 真の人気作を優先
//
export interface FanzaRevenueScore {
  score: number;
  qualityScore: number;
  clickBoost: number;
  impressionBoost: number;
  detail: {
    review: number;
    rating: number;
    sale: number;
    sample: number;
    genre: number;
    actress: number;
    freshness: number;
    affinity: number;
    impression: number;
  };
  reasons: string[];
}

const HIGH_INTENT_GENRES = ['素人', '人妻', 'OL', 'お姉さん', 'ギャル', '美少女', '巨乳', '中出し', '企画', '単体作品'];

function collectNames(values: any): string[] {
  return Array.isArray(values)
    ? values.map((v: any) => typeof v === 'string' ? v : v?.name ?? '').filter(Boolean)
    : [];
}

export function scoreFanzaItem(item: any): FanzaRevenueScore {
  const avg = parseFloat(item.review?.average ?? '0');
  const count = item.review?.count ?? 0;
  const reasons: string[] = [];
  if (avg === 0 || count === 0) {
    return {
      score: 0,
      qualityScore: 0,
      clickBoost: 0,
      impressionBoost: 0,
      detail: { review: 0, rating: 0, sale: 0, sample: 0, genre: 0, actress: 0, freshness: 0, affinity: 0, impression: 0 },
      reasons: ['レビュー不足'],
    };
  }

  // ベイズ平均: 事前平均 m=4.0、基準レビュー数 C=50
  const C = 50;
  const m = 4.0;
  const bayesianAvg = (C * m + count * avg) / (C + count);

  const reviewScore = Math.min(Math.log10(count + 1) * 1.15, 3);
  const ratingScore = Math.max(0, (bayesianAvg - 3.7) * 1.6);
  const qualityScore = reviewScore + ratingScore;
  const clickSignals = getProductClickSignals();
  const priorClicks = clickSignals[item.content_id] ?? 0;
  const clickBoost = priorClicks > 0 ? Math.min(Math.log10(priorClicks + 1) * 1.1, 1.8) : 0;
  const sampleCount = getSampleImages(item).length;
  const sampleBoost = sampleCount >= 4 ? 0.55 : sampleCount >= 2 ? 0.42 : sampleCount > 0 ? 0.3 : 0;
  const title = String(item.title ?? '');
  const price = String(item.prices?.price ?? item.price ?? '');
  const listPrice = String(item.prices?.list_price ?? item.prices?.listPrice ?? '');
  const campaignText = JSON.stringify(item.campaign ?? item.campaigns ?? item.prices ?? '');
  const saleBoost = /セール|sale|SALE|割引|限定|キャンペーン|%OFF|OFF|ポイント|還元/.test(`${title} ${price} ${listPrice} ${campaignText}`) ? 0.75 : 0;
  const freshBoost = item.date && Date.now() - new Date(item.date).getTime() < 45 * 86400000 ? 0.35 : 0;
  const genres = collectNames(item.iteminfo?.genre ?? item.genre);
  const matchedGenres = genres.filter((g) => HIGH_INTENT_GENRES.some((keyword) => g.includes(keyword) || title.includes(keyword)));
  const genreBoost = Math.min(matchedGenres.length * 0.18, 0.72);
  const actresses = collectNames(item.iteminfo?.actress ?? item.actress);
  const actressBoost = actresses.length >= 2 ? 0.28 : actresses.length === 1 ? 0.18 : 0;
  const clickedSignals = getClickedProductSignals(80);
  let affinityBoost = 0;
  let impressionBoost = 0;
  for (const signal of clickedSignals) {
    const signalText = `${signal.productTitle} ${signal.productId}`;
    const clickWeight = Math.min(Math.log10(signal.clicks + 1) * 0.18, 0.36);
    const impressionWeight = Math.min(Math.log10((signal.impressions || 0) + 1) * 0.06, 0.32);
    const sameActress = actresses.some((name) => name.length >= 2 && signalText.includes(name));
    const sameGenre = genres.some((name) => name.length >= 2 && signalText.includes(name));
    const titleHit = title
      .split(/[ 　【】「」『』（）()・,，。:：/]+/)
      .filter((word) => word.length >= 3)
      .slice(0, 5)
      .some((word) => signalText.includes(word));
    if (sameActress) { affinityBoost += clickWeight; impressionBoost += impressionWeight; }
    if (sameGenre) { affinityBoost += clickWeight * 0.6; impressionBoost += impressionWeight * 0.7; }
    if (titleHit) { affinityBoost += clickWeight * 0.4; impressionBoost += impressionWeight * 0.5; }
  }
  affinityBoost = Math.min(affinityBoost, 0.95);
  impressionBoost = Math.min(impressionBoost, 0.75);

  if (count >= 50) reasons.push(`レビュー${count}件`);
  if (avg >= 4.5) reasons.push(`高評価${avg.toFixed(1)}`);
  if (priorClicks > 0) reasons.push(`過去クリック${priorClicks}`);
  if (affinityBoost > 0) reasons.push('近い作品でクリック実績');
  if (impressionBoost > 0) reasons.push('近い作品でインプ実績');
  if (sampleBoost > 0) reasons.push(`サンプル${sampleCount}枚`);
  if (saleBoost > 0) reasons.push('セール訴求向き');
  if (genreBoost > 0) reasons.push(`強ジャンル:${matchedGenres.slice(0, 2).join('/')}`);
  if (actressBoost > 0) reasons.push(actresses.length >= 2 ? '複数女優' : '女優名あり');
  if (freshBoost > 0) reasons.push('新しめ');
  if (count < 15) reasons.push('レビュー少なめ');

  return {
    score: Number((qualityScore + clickBoost + affinityBoost + impressionBoost + sampleBoost + saleBoost + genreBoost + actressBoost + freshBoost).toFixed(3)),
    qualityScore: Number(qualityScore.toFixed(3)),
    clickBoost: Number(clickBoost.toFixed(3)),
    impressionBoost: Number(impressionBoost.toFixed(3)),
    detail: {
      review: Number(reviewScore.toFixed(3)),
      rating: Number(ratingScore.toFixed(3)),
      sale: Number(saleBoost.toFixed(3)),
      sample: Number(sampleBoost.toFixed(3)),
      genre: Number(genreBoost.toFixed(3)),
      actress: Number(actressBoost.toFixed(3)),
      freshness: Number(freshBoost.toFixed(3)),
      affinity: Number(affinityBoost.toFixed(3)),
      impression: Number(impressionBoost.toFixed(3)),
    },
    reasons: reasons.slice(0, 5),
  };
}

function compositeScore(item: any): number {
  return scoreFanzaItem(item).score;
}

// ─── 最低品質フィルター ──────────────────────────────────────────────────────
// レビュー数・平均評価の最低ラインを設定し、低品質作品を除外する

function qualityFilter(item: any, opts: { minReviews?: number; minAvg?: number } = {}): boolean {
  const count = item.review?.count ?? 0;
  const avg = parseFloat(item.review?.average ?? '0');
  return count >= (opts.minReviews ?? 5) && avg >= (opts.minAvg ?? 4.0);
}

// スコアでソートし上位N件を返す共通ユーティリティ
function topByScore(items: any[], n: number, minReviews = 5, minAvg = 4.0): any[] {
  const filtered = items.filter((i) => qualityFilter(i, { minReviews, minAvg }));
  const pool = filtered.length >= n ? filtered : items; // フィルター後が足りなければ全体使用
  return pool
    .map((item) => ({ item, score: compositeScore(item) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(n * 3, 10)) // 上位3倍を候補として渡す
    .map((s) => s.item);
}

export function rankRevenueCandidates(items: any[], count = 10): Array<any & { revenueScore: FanzaRevenueScore }> {
  const dedupMap = new Map<string, any>();
  for (const item of items) {
    if (item?.content_id) dedupMap.set(item.content_id, item);
  }
  return [...dedupMap.values()]
    .map((item) => ({ ...item, revenueScore: scoreFanzaItem(item) }))
    .sort((a, b) => b.revenueScore.score - a.revenueScore.score)
    .slice(0, count);
}

export function rankImpressionCandidates(items: any[], count = 10): Array<any & { revenueScore: FanzaRevenueScore }> {
  return rankRevenueCandidates(items, Math.max(count, 10))
    .sort((a, b) => (
      (b.revenueScore.impressionBoost - a.revenueScore.impressionBoost) ||
      (b.revenueScore.score - a.revenueScore.score) ||
      ((b.review?.count ?? 0) - (a.review?.count ?? 0))
    ))
    .slice(0, count);
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

// 素人系 — FANZA素人フロア（floor=videoc）を優先取得、品質スコア順で返す
export async function getAmateurItems(count = 2) {
  const sorts = ['rank', 'review'] as const;
  const allItems: any[] = [];

  // ① FANZA素人専用フロアから rank・review 両方取得してプール
  for (const sort of sorts) {
    try {
      const offset = randomOffset(100);
      console.log(`  🔍 FANZA素人フロア: sort=${sort} offset=${offset}`);
      const items = await fetchAmaItems({ sort, offset });
      allItems.push(...items);
    } catch (e: any) {
      console.warn(`  ⚠ FANZA素人フロア(${sort})失敗: ${e.message}`);
    }
  }

  if (allItems.length >= count) {
    const dedupMap = new Map<string, any>();
    for (const item of allItems) dedupMap.set(item.content_id, item);
    const scored = topByScore([...dedupMap.values()], count, 5, 4.0);
    console.log(`  ✅ 素人: スコアトップ ★${scored[0]?.review?.average} × ${scored[0]?.review?.count}件`);
    return pickNUnique(scored, count);
  }

  // ② キーワード検索フォールバック（videoa フロア）
  const keyword = pickRandom(AMATEUR_KEYWORDS);
  console.log(`  🔀 素人フォールバック: keyword="${keyword}"`);
  const fallback = await fetchItems({ keyword, sort: 'review', offset: randomOffset(100) });
  const scored = topByScore(fallback, count, 3, 3.8);
  return pickNUnique(scored.length >= count ? scored : fallback, count);
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
  const offset = '1';
  console.log(`  🔍 ランキング検索: offset=${offset}`);
  const items = await fetchItems({ sort: 'rank', offset });
  return topNUnique(rankImpressionCandidates(items, Math.max(count, 10)), count);
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

  // ② キーワードフォールバック（品質スコア優先）
  const keyword = pickRandom(SALE_KEYWORDS);
  const offset = randomOffset(50);
  console.log(`  🔍 セール検索（キーワード）: keyword="${keyword}" offset=${offset}`);
  try {
    const items = await fetchItems({ sort: 'review', keyword, offset });
    if (items.length > 0) {
      const scored = topByScore(items, count, 10, 4.0);
      return pickNUnique(scored.length >= count ? scored : items, count);
    }
  } catch (e: any) {
    console.warn(`  ⚠ セールキーワード検索失敗: ${e.message}`);
  }

  // ③ 最終フォールバック：ランキング上位 × 品質フィルター
  console.log('  🔀 セール: ランキングフォールバック（品質フィルター付き）');
  const fallback = await fetchItems({ sort: 'rank', offset: randomOffset(100) });
  const scored = topByScore(fallback, count, 5, 4.0);
  return pickNUnique(scored.length >= count ? scored : fallback, count);
}

// ランダム — ランダム性を残しつつ品質フィルターを適用
export async function getRandomItems(count = 2) {
  const sorts = ['rank', 'review'] as const;
  const sort = pickRandom([...sorts]);
  const offset = randomOffset(200);
  console.log(`  🔍 ランダム検索: sort=${sort} offset=${offset}`);
  const items = await fetchItems({ sort, offset });

  // 品質フィルター通過後にランダム選択（低品質作品を自然に除外）
  const quality = items.filter((i) => qualityFilter(i, { minReviews: 5, minAvg: 4.0 }));
  const pool = quality.length >= count ? quality : items;
  return pickNUnique(pool, count);
}

export async function getRevenueOptimizedItems(count = 10, keyword?: string) {
  const pools = await Promise.all([
    fetchItems({ sort: 'rank', offset: randomOffset(150), ...(keyword ? { keyword } : {}) }).catch(() => []),
    fetchItems({ sort: 'review', offset: randomOffset(150), ...(keyword ? { keyword } : {}) }).catch(() => []),
    fetchItems({ sort: 'date', offset: randomOffset(80), ...(keyword ? { keyword } : {}) }).catch(() => []),
  ]);
  const items = pools.flat();
  const ranked = rankRevenueCandidates(items, Math.max(count * 2, 20));
  return topNUnique(ranked, count);
}

// キーワード検索（手動トリガー用）
export async function getKeywordItems(keyword: string, count = 1) {
  const pools = await Promise.all([
    fetchItems({ keyword, sort: 'rank', hits: '40', offset: '1' }).catch(() => []),
    fetchItems({ keyword, sort: 'review', hits: '40', offset: '1' }).catch(() => []),
    fetchItems({ keyword, sort: 'date', hits: '40', offset: '1' }).catch(() => []),
  ]);
  const ranked = rankImpressionCandidates(pools.flat(), Math.max(count * 3, 15));
  return topNUnique(ranked, count);
}

// 商品ID直接指定
export async function getItemById(cid: string): Promise<any | null> {
  const items = await fetchItems({ cid });
  return items[0] ?? null;
}

// サンプル画像取得
export function getSampleImages(item: any): string[] {
  const rawSamples = item.sampleImageURL?.sample_l?.image
    ?? item.sampleImageURL?.sample_s?.image
    ?? item.sampleImages
    ?? [];
  const samples = Array.isArray(rawSamples) ? rawSamples : [rawSamples];
  const fallback = [item.imageURL?.large, item.imageURL?.small, item.thumbnail].filter(Boolean);
  return [...new Set([...samples, ...fallback])]
    .filter((url): url is string => typeof url === 'string' && /^https?:\/\//.test(url))
    .slice(0, 8);
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
