/**
 * rebrandly.ts — Rebrandly短縮URLクリック数自動同期
 *
 * 環境変数 REBRANDLY_API_KEY が未設定の場合はスキップ（サイレント動作）。
 * 毎日 06:00 JST にスケジューラーから呼び出す。
 */

import { upsertRebrandlyLinks, getRebrandlyData, RebrandlyLink } from './storage.js';

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

  const totalClicks = links.reduce((s, l) => s + l.clicks, 0);
  console.log(`  ✅ [Rebrandly] ${links.length}件同期完了 / 合計クリック: ${totalClicks}`);
  return { synced: links.length, totalClicks };
}

/**
 * 作品IDからRebrandly用のslashtag文字列を生成。
 * 英数字とハイフンのみ許可（Rebrandly仕様）。
 */
function toSlashtag(itemId: string): string {
  return itemId.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase().slice(0, 50);
}

/**
 * Rebrandly APIで新しい短縮リンクを作成する。
 * 作成したリンクはストレージに追加して返す。
 */
async function createRebrandlyLink(
  itemId: string,
  title: string,
  affiliateUrl: string,
): Promise<string | null> {
  const apiKey = process.env.REBRANDLY_API_KEY;
  if (!apiKey) return null;

  const slashtag = toSlashtag(itemId);

  try {
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
      // 409 = slashtag重複（すでに存在する）→ そのまま使う
      if (res.status === 409) {
        console.log(`  🔗 [Rebrandly] slashtag既存: ${slashtag}`);
        const short = `https://rebrand.ly/${slashtag}`;
        return short;
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

    // ストレージに追加
    const current = getRebrandlyData();
    upsertRebrandlyLinks([...current.links, newLink]);

    const short = `https://rebrand.ly/${data.slashtag}`;
    console.log(`  ✅ [Rebrandly] 新規リンク作成: ${data.slashtag} → ${short}`);
    return short;
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
