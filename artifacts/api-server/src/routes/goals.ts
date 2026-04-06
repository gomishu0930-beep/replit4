/**
 * goals.ts — 目標・週次KPI管理ルート
 *
 * 会議で確定した週次目標・Gate達成条件を管理し、
 * 実際の投稿データと突合して進捗を返す。
 */

import { Router } from 'express';
import { getAllPosts } from '../bot/storage.js';

const router = Router();

// ─── 目標定義（会議確定値）────────────────────────────────────────────────────

const GOAL = {
  base:    30000,
  stretch: 50000,
  period:  '3ヶ月',
  startDate: '2026-04-06',
};

interface WeekKPI {
  metric: string;
  label: string;
  target: number | string;
  unit: string;
  higherIsBetter: boolean;
}

interface WeekDef {
  week: string;
  start: string;
  end: string;
  slot: string;
  kpis: WeekKPI[];
  note?: string;
}

const WEEKS: WeekDef[] = [
  {
    week: 'W1', start: '2026-04-07', end: '2026-04-13', slot: '10:30 JST',
    kpis: [
      { metric: 'avgIMP', label: 'Avg インプ/投稿', target: 15, unit: 'IMP', higherIsBetter: true },
    ],
    note: 'シャドウバン回復確認・スロットABテスト開始',
  },
  {
    week: 'W2', start: '2026-04-14', end: '2026-04-20', slot: '05:00 JST',
    kpis: [
      { metric: 'avgIMP',   label: 'Avg インプ/投稿',  target: 30,   unit: 'IMP',  higherIsBetter: true },
      { metric: 'totalLike', label: 'いいね合計',        target: 3,    unit: '件',   higherIsBetter: true },
    ],
    note: 'スロット5時テスト・高単価投稿×3',
  },
  {
    week: 'W3', start: '2026-04-21', end: '2026-04-27', slot: '動的',
    kpis: [
      { metric: 'followerGain', label: 'フォロワー純増', target: 30, unit: '人', higherIsBetter: true },
    ],
    note: 'SIM購入・サブ垢作成・LP公開',
  },
  {
    week: 'W4', start: '2026-04-28', end: '2026-05-04', slot: '動的',
    kpis: [
      { metric: 'gate0', label: 'G0 判定', target: 'pass', unit: '', higherIsBetter: true },
    ],
    note: 'G0判定 (4/13)・テンプレ微調整',
  },
  {
    week: 'W5', start: '2026-05-05', end: '2026-05-11', slot: '動的',
    kpis: [
      { metric: 'ctr', label: 'CTR', target: 0.3, unit: '%', higherIsBetter: true },
    ],
    note: 'サブ垢いいね/リプ開始・X広告申請',
  },
  {
    week: 'W6', start: '2026-05-12', end: '2026-05-18', slot: '動的',
    kpis: [
      { metric: 'followerGain', label: 'フォロワー純増', target: 50,  unit: '人', higherIsBetter: true },
      { metric: 'totalLike',    label: 'Like累計',        target: 5,   unit: '件', higherIsBetter: true },
    ],
    note: 'エンゲージメント最適化・LP リライト',
  },
  {
    week: 'W7', start: '2026-05-19', end: '2026-05-25', slot: '動的',
    kpis: [
      { metric: 'monthlyClick', label: 'クリック/月',  target: 100, unit: '件', higherIsBetter: true },
      { metric: 'gate1',        label: 'G1 判定',       target: 'pass', unit: '', higherIsBetter: true },
    ],
    note: 'G1判定・広告クリエイティブ作成',
  },
];

interface GateDef {
  id: string;
  date: string;
  label: string;
  conditions: { metric: string; label: string; target: number | string; unit: string }[];
}

const GATES: GateDef[] = [
  {
    id: 'G0', date: '2026-04-13', label: '初回回復ゲート',
    conditions: [
      { metric: 'avgIMP',   label: 'Avg インプ',  target: 15,  unit: 'IMP' },
      { metric: 'totalLike', label: 'いいね',       target: 1,   unit: '件' },
    ],
  },
  {
    id: 'G1', date: '2026-05-25', label: 'SBバン解除ゲート',
    conditions: [
      { metric: 'shadowbanLifted', label: 'SBバン解除',   target: 'yes', unit: '' },
      { metric: 'ctr',             label: 'CTR',           target: 0.3,   unit: '%' },
    ],
  },
  {
    id: 'G2', date: '2026-06-30', label: '広告ゲート',
    conditions: [
      { metric: 'avgIMP',       label: 'Avg インプ',   target: 500, unit: 'IMP' },
      { metric: 'monthlyClick', label: 'クリック/月',  target: 100, unit: '件' },
    ],
  },
];

// ─── ヘルパー：週範囲のポストを集計 ─────────────────────────────────────────

function postsInRange(posts: any[], start: string, end: string) {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime() + 86400000; // end を含む
  return posts.filter((p) => {
    const t = new Date(p.postedAt).getTime();
    return t >= s && t < e;
  });
}

function avgIMP(posts: any[]): number | null {
  const withIMP = posts.filter((p) => p.metrics?.impression_count != null);
  if (withIMP.length === 0) return null;
  return Math.round(withIMP.reduce((s, p) => s + p.metrics.impression_count, 0) / withIMP.length);
}

function totalLike(posts: any[]): number {
  return posts.reduce((s, p) => s + (p.metrics?.like_count ?? 0), 0);
}

function getWeekStatus(start: string, end: string): 'upcoming' | 'current' | 'past' {
  const now = new Date().toISOString().slice(0, 10);
  if (now < start) return 'upcoming';
  if (now > end) return 'past';
  return 'current';
}

// ─── GET /api/bot/goals ───────────────────────────────────────────────────────

router.get('/bot/goals', (req, res) => {
  const posts = getAllPosts();

  const weeks = WEEKS.map((w) => {
    const wPosts = postsInRange(posts, w.start, w.end);
    const status = getWeekStatus(w.start, w.end);
    const actualMap: Record<string, number | null> = {
      avgIMP:    avgIMP(wPosts),
      totalLike: totalLike(wPosts),
      ctr:       null, // 外部計測（Rebrandly）
      followerGain: null, // 手動入力
      monthlyClick: null, // 外部計測
    };
    const kpisWithActual = w.kpis.map((kpi) => {
      const actual = typeof kpi.target === 'number' ? (actualMap[kpi.metric] ?? null) : null;
      const achieved = typeof kpi.target === 'number' && actual !== null
        ? (kpi.higherIsBetter ? actual >= kpi.target : actual <= kpi.target)
        : null;
      return { ...kpi, actual, achieved };
    });
    return {
      ...w,
      status,
      postCount: wPosts.length,
      kpis: kpisWithActual,
    };
  });

  const gates = GATES.map((g) => {
    const now = new Date().toISOString().slice(0, 10);
    const gateStatus = now < g.date ? 'upcoming' : now === g.date ? 'today' : 'past';

    // G0 の判定: G0日付までの全ポストで計算
    let conditionsWithActual = g.conditions.map((c) => ({ ...c, actual: null as any, achieved: null as boolean | null }));
    if (g.id === 'G0') {
      const range = postsInRange(posts, '2026-04-06', g.date);
      const imp = avgIMP(range);
      const likes = totalLike(range);
      conditionsWithActual = g.conditions.map((c) => {
        if (c.metric === 'avgIMP')    return { ...c, actual: imp,   achieved: imp !== null && imp   >= (c.target as number) };
        if (c.metric === 'totalLike') return { ...c, actual: likes, achieved: likes >= (c.target as number) };
        return { ...c, actual: null, achieved: null };
      });
    }
    return { ...g, status: gateStatus, conditions: conditionsWithActual };
  });

  res.json({ goal: GOAL, weeks, gates });
});

export default router;
