/**
 * rebrandly.ts — Rebrandly短縮URLクリック数自動同期
 *
 * 環境変数 REBRANDLY_API_KEY が未設定の場合はスキップ（サイレント動作）。
 * 毎日 06:00 JST にスケジューラーから呼び出す。
 */

import { upsertRebrandlyLinks, RebrandlyLink } from './storage.js';

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
    const data: RebrandlyApiLink[] = await res.json();
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
 * アフィリエイトURLに対応するRebrandly短縮URLを返す。
 * 登録がなければ元のURLをそのまま返す（フォールバック）。
 */
export function resolveShortUrl(affiliateUrl: string): string {
  const { links } = getRebrandlyData();
  if (links.length === 0) return affiliateUrl;

  // destinationが完全一致するリンクを探す
  const match = links.find(l => l.destination === affiliateUrl);
  if (match) {
    const short = `https://rebrand.ly/${match.slashtag}`;
    console.log(`  🔗 [Rebrandly] 短縮URL適用: ${match.slashtag}`);
    return short;
  }
  return affiliateUrl;
}
