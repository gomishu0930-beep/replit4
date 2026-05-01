/**
 * rebrandly.ts — Rebrandly短縮URLクリック数自動同期
 *
 * 環境変数 REBRANDLY_API_KEY が未設定の場合はスキップ（サイレント動作）。
 * 毎日 06:00 JST にスケジューラーから呼び出す。
 */

import { upsertRebrandlyLinks, getRebrandlyData, RebrandlyLink } from './storage.js';
import { syncAnalyticsClicksFromRebrandly } from './post-analytics.js';

const REBRANDLY_BASE = 'https://api.rebrandly.com/v1';

interface RebrandlyApiLink {
  id: string;
  slashtag: string;
  destination: string;
  title: string;
  clicks: number;
  createdAt: string;
}

export async function syncRebrandlyClicks(): Promise<{
  synced: number;
  totalClicks: number;
} | null> {
  const apiKey = process.env.REBRANDLY_API_KEY;
  if (!apiKey) {
    console.log('  ℹ️  [Rebrandly] REBRANDLY_API_KEY 未設定 → スキップ');
    return null;
  }

  const headers = {
    'apikey': apiKey,
    'Content-Type': 'application/json',
  };

  let allLinks: RebrandlyApiLink[] = [];
  const limit = 25;
  let lastId: string | null = null;

  // ページネーション（最大200件）- lastはリンクIDで指定するカーソル方式
  for (let page = 0; page < 8; page++) {
    const params = new URLSearchParams({
      limit: String(limit),
      orderBy: 'createdAt',
      orderDir: 'desc',
    });
    if (lastId) params.set('last', lastId);

    const url = `${REBRANDLY_BASE}/links?${params.toString()}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Rebrandly API エラー (${res.status}): ${body.slice(0, 200)}`);
    }
    const data = await res.json() as RebrandlyApiLink[];
    if (data.length === 0) break;
    allLinks = allLinks.concat(data);
    if (data.length < limit) break;
    lastId = data[data.length - 1].id;
  }

  // FANZA系のみフィルタ（オプション: destination に al.dmm.co.jp を含む）
  const fanzaLinks = allLinks.filter(l =>
    l.destination.includes('al.dmm.co.jp') ||
    l.destination.includes('dmm.co.jp') ||
    l.destination.includes('fanza'),
  );

  // 全リンク（FANZAフィルタがゼロの場合は全て対象）
  const targetLinks = fanzaLinks.length > 0 ? fanzaLinks : allLinks;

  const now = new Date().toISOString();
  const links: RebrandlyLink[] = targetLinks.map(l => ({
    id: l.id,
    slashtag: l.slashtag,
    destination: l.destination,
    title: l.title || l.slashtag,
    clicks: l.clicks,
    lastSyncedAt: now,
  }));

  upsertRebrandlyLinks(links);
  const analyticsUpdated = syncAnalyticsClicksFromRebrandly(links);

  const totalClicks = links.reduce((s, l) => s + l.clicks, 0);
  console.log(`  ✅ [Rebrandly] ${links.length}件同期完了 / 合計クリック: ${totalClicks} / Analytics更新: ${analyticsUpdated}件`);
  return { synced: links.length, totalClicks };
}

export function getRebrandlyStatus() {
  const data = getRebrandlyData();
  return {
    apiKeyConfigured: Boolean(process.env.REBRANDLY_API_KEY),
    storedLinks: data.links.length,
    totalClicks: data.links.reduce((s, l) => s + l.clicks, 0),
    lastSyncedAt: data.lastSyncedAt,
  };
}

/**
 * 作品IDからRebrandly用のslashtag文字列を生成。
 * 英数字とハイフンのみ許可（Rebrandly仕様）。
 */
function toSlashtag(itemId: string, suffix = ''): string {
  const base = itemId.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '');
  const slug = suffix ? `${base.slice(0, Math.max(1, 46 - suffix.length))}${suffix}` : base.slice(0, 46);
  // Rebrandly: slashtag must start with a letter (not digit or hyphen)
  return /^[a-z]/.test(slug) ? slug : `fz-${slug}`;
}

/**
 * Rebrandly APIで新しい短縮リンクを作成する。
 * 作成したリンクはストレージに追加して返す。
 */
export async function createRebrandlyLink(
  itemId: string,
  title: string,
  affiliateUrl: string,
): Promise<string | null> {
  const apiKey = process.env.REBRANDLY_API_KEY;
  if (!apiKey) return null;

  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const slashtag = toSlashtag(itemId, attempt === 0 ? '' : `-${attempt + 1}`);
      const res = await fetch(`${REBRANDLY_BASE}/links`, {
        method: 'POST',
        headers: {
          'apikey': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          destination: affiliateUrl,
          slashtag,
          title: title.slice(0, 100),
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        if (res.status === 409) {
          console.log(`  🔗 [Rebrandly] slashtag既存: ${slashtag}`);
          await syncRebrandlyClicks().catch(() => null);
          const existing = getRebrandlyData().links.find(l => l.destination === affiliateUrl);
          if (existing) return `https://rebrand.ly/${existing.slashtag}`;
          continue;
        }
        console.warn(`  ⚠ [Rebrandly] リンク作成失敗 (${res.status}): ${body.slice(0, 100)}`);
        return null;
      }

      const data = await res.json() as RebrandlyApiLink;
      const now = new Date().toISOString();
      const newLink: RebrandlyLink = {
        id: data.id,
        slashtag: data.slashtag,
        destination: data.destination,
        title: data.title || title,
        clicks: 0,
        lastSyncedAt: now,
      };

      const current = getRebrandlyData();
      upsertRebrandlyLinks([...current.links.filter(l => l.destination !== newLink.destination), newLink]);

      const short = `https://rebrand.ly/${data.slashtag}`;
      console.log(`  ✅ [Rebrandly] 新規リンク作成: ${data.slashtag} → ${short}`);
      return short;
    }
    console.warn(`  ⚠ [Rebrandly] slashtag重複によりリンク作成スキップ: ${itemId}`);
    return null;
  } catch (e: any) {
    console.warn(`  ⚠ [Rebrandly] リンク作成例外: ${e.message}`);
    return null;
  }
}

/**
 * アフィリエイトURLに対応するRebrandly短縮URLを返す。
 * 未登録の場合は自動作成する。作成失敗時は元のURLを返す（フォールバック）。
 */
export async function resolveShortUrl(
  affiliateUrl: string,
  itemId?: string,
  itemTitle?: string,
): Promise<string> {
  if (!affiliateUrl) return affiliateUrl;

  const { links } = getRebrandlyData();

  // 既存リンクと照合
  const match = links.find(l => l.destination === affiliateUrl);
  if (match) {
    const short = `https://rebrand.ly/${match.slashtag}`;
    console.log(`  🔗 [Rebrandly] 既存短縮URL使用: ${match.slashtag}`);
    return short;
  }

  // REBRANDLY_API_KEY があり itemId が渡されていれば自動作成
  if (process.env.REBRANDLY_API_KEY && itemId) {
    const short = await createRebrandlyLink(itemId, itemTitle ?? itemId, affiliateUrl);
    if (short) return short;
  }

  return affiliateUrl;
}

export async function autoCreateRebrandlyLinks(candidates: Array<{
  affiliateUrl?: string;
  itemId?: string;
  title?: string;
}>): Promise<{
  attempted: number;
  created: number;
  reused: number;
  skipped: number;
  items: Array<{ affiliateUrl: string; shortUrl: string; status: 'created' | 'reused' | 'skipped' }>;
}> {
  const unique = new Map<string, { affiliateUrl: string; itemId: string; title: string }>();
  for (const c of candidates) {
    if (!c.affiliateUrl || !c.itemId) continue;
    unique.set(c.affiliateUrl, {
      affiliateUrl: c.affiliateUrl,
      itemId: c.itemId,
      title: c.title ?? c.itemId,
    });
  }

  let created = 0;
  let reused = 0;
  let skipped = 0;
  const items: Array<{ affiliateUrl: string; shortUrl: string; status: 'created' | 'reused' | 'skipped' }> = [];

  for (const c of unique.values()) {
    const existing = getRebrandlyData().links.find(l => l.destination === c.affiliateUrl);
    if (existing) {
      reused++;
      items.push({ affiliateUrl: c.affiliateUrl, shortUrl: `https://rebrand.ly/${existing.slashtag}`, status: 'reused' });
      continue;
    }

    const before = getRebrandlyData().links.length;
    const shortUrl = await resolveShortUrl(c.affiliateUrl, c.itemId, c.title);
    if (shortUrl === c.affiliateUrl) {
      skipped++;
      items.push({ affiliateUrl: c.affiliateUrl, shortUrl, status: 'skipped' });
      continue;
    }

    const after = getRebrandlyData().links.length;
    const status = after > before ? 'created' : 'reused';
    if (status === 'created') created++; else reused++;
    items.push({ affiliateUrl: c.affiliateUrl, shortUrl, status });
  }

  return { attempted: unique.size, created, reused, skipped, items };
}
