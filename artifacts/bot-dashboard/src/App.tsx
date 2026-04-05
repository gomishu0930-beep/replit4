import { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  ResponsiveContainer, LineChart, Line, Cell, Legend,
} from "recharts";

const queryClient = new QueryClient();
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = "";

// ─── 型定義 ──────────────────────────────────────────────────────────────────

interface Stats {
  totalPosts: number;
  postsLast7Days: number;
  lastPostedAt: string | null;
  lastPostTitle: string | null;
  totalLikes: number;
  totalRetweets: number;
}
interface BotStatus {
  status: string;
  uptime: number;
  account: string;
  schedule: { time: string; type: string; label: string }[];
  stats: Stats;
}
interface Post {
  tweetId: string;
  type: string;
  contentType?: string;
  text: string;
  item: { id: string; title: string; affiliateURL: string };
  postedAt: string;
  metrics: { like_count: number; retweet_count: number; reply_count?: number; bookmark_count?: number } | null;
}
interface ExternalPattern {
  tweetId: string;
  text: string;
  like_count: number;
  retweet_count: number;
  bookmark_count: number;
  score: number;
  source: string;
}
interface ExternalInfo {
  count: number;
  lastRefreshedAt: string | null;
  queries: string[];
  topPatterns: ExternalPattern[];
}
interface Hypothesis {
  id: string;
  question: string;
  status: "pending" | "confirmed" | "rejected" | "adjusted";
  finding: string;
  adjustment: string | null;
  testedAt: string;
}
interface DecisionLog {
  at: string;
  cycle: number;
  decisions: string[];
}
interface StrategyData {
  monitorIntervalHours: number;
  typeWeights: Record<string, number>;
  cycleStats: { lastNewPatterns: number; avgNewPatterns: number; totalCycles: number };
  hypotheses: Hypothesis[];
  lastEvaluatedAt: string | null;
  recentDecisions: DecisionLog[];
  dynamicTemplates: { count: number; lastEvolvedAt: string | null; evolutionCount: number };
}
interface WatchdogEvent {
  at: string;
  level: "info" | "warn" | "error" | "recovery";
  detail: string;
}
interface WatchdogData {
  lastCheckAt: string | null;
  lastIssueAt: string | null;
  lastRecoveryAt: string | null;
  status: "healthy" | "issue" | "recovering" | "failed";
  issueCount: number;
  recoveryCount: number;
  consecutiveFailures: number;
  events: WatchdogEvent[];
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────

function formatUptime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function typeLabel(t: string) {
  const m: Record<string, string> = {
    amateur: "素人", rank: "ランキング", sale: "セール",
    buzz: "バズ/高評価", random: "ランダム", celebrity: "芸能人似",
    impression: "インプ狙い", emergency: "緊急",
  };
  return m[t] ?? t;
}
function typeBadge(t: string) {
  const m: Record<string, string> = {
    amateur:    "bg-rose-500/20 text-rose-300 border-rose-500/30",
    rank:       "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    sale:       "bg-green-500/20 text-green-300 border-green-500/30",
    buzz:       "bg-pink-500/20 text-pink-300 border-pink-500/30",
    random:     "bg-purple-500/20 text-purple-300 border-purple-500/30",
    celebrity:  "bg-orange-500/20 text-orange-300 border-orange-500/30",
    impression: "bg-sky-500/20 text-sky-300 border-sky-500/30",
    emergency:  "bg-red-500/20 text-red-300 border-red-500/30",
  };
  return m[t] ?? "bg-gray-500/20 text-gray-300 border-gray-500/30";
}
function calcScore(m: Post["metrics"]) {
  if (!m) return 0;
  return m.like_count + m.retweet_count * 3 + (m.bookmark_count ?? 0) * 2 + (m.reply_count ?? 0);
}

// ─── 共通コンポーネント ────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs text-white/50 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent ?? "text-white"}`}>{value}</p>
      {sub && <p className="text-xs text-white/40 mt-1">{sub}</p>}
    </div>
  );
}

function HypothesisCard({ h }: { h: Hypothesis }) {
  const cfg = {
    pending:   { icon: "⏳", cls: "border-white/10 bg-white/5",             label: "検証中" },
    confirmed: { icon: "✅", cls: "border-emerald-500/30 bg-emerald-500/10", label: "確認済" },
    rejected:  { icon: "❌", cls: "border-red-500/30 bg-red-500/10",         label: "否定" },
    adjusted:  { icon: "🔧", cls: "border-blue-500/30 bg-blue-500/10",       label: "調整済" },
  }[h.status];

  return (
    <div className={`rounded-lg border p-3 ${cfg.cls}`}>
      <div className="flex items-start gap-2">
        <span className="text-base mt-0.5 shrink-0">{cfg.icon}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-white/80">{h.question}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50 shrink-0">{cfg.label}</span>
          </div>
          <p className="text-xs text-white/50">{h.finding}</p>
          {h.adjustment && (
            <p className="text-xs text-blue-300 mt-1">→ {h.adjustment}</p>
          )}
          <p className="text-[10px] text-white/20 mt-1">検証: {fmtDate(h.testedAt)}</p>
        </div>
      </div>
    </div>
  );
}

function TypeWeightBar({ weights }: { weights: Record<string, number> }) {
  const data = Object.entries(weights).map(([type, weight]) => ({
    type: typeLabel(type), weight: Math.round(weight * 100) / 100, raw: type,
  }));
  const colors: Record<string, string> = {
    amateur: "#fb7185", rank: "#fbbf24", sale: "#34d399",
    buzz: "#f472b6", random: "#a78bfa", celebrity: "#fb923c",
  };
  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="type" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }} />
        <YAxis domain={[0, 2]} tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }} />
        <RechartTooltip
          contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
          formatter={(v: number) => [v.toFixed(2), "重み"]}
        />
        <Bar dataKey="weight" radius={[4, 4, 0, 0]}>
          {data.map((d) => <Cell key={d.raw} fill={colors[d.raw] ?? "#6b7280"} fillOpacity={0.85} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function EngagementChart({ posts }: { posts: Post[] }) {
  const data = [...posts]
    .filter((p) => p.metrics)
    .sort((a, b) => new Date(a.postedAt).getTime() - new Date(b.postedAt).getTime())
    .slice(-20)
    .map((p) => ({ date: fmtDate(p.postedAt).slice(0, 5), score: calcScore(p.metrics), type: p.type }));

  if (data.length === 0) return (
    <div className="flex items-center justify-center h-28 text-xs text-white/30">データ蓄積中...</div>
  );
  return (
    <ResponsiveContainer width="100%" height={120}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }} />
        <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }} />
        <RechartTooltip
          contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
          formatter={(v: number) => [v, "エンゲージメントスコア"]}
        />
        <Line type="monotone" dataKey="score" stroke="#818cf8" strokeWidth={2} dot={{ fill: "#818cf8", r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── 分析用グラフ ─────────────────────────────────────────────────────────────

// 5型コンテンツ エンゲージメント比較
function ContentType5Chart({ posts }: { posts: Post[] }) {
  const typeDef = ["レビュー型", "比較型", "ランキング型", "失敗回避型", "共感型", "テンプレート型"];
  const colors  = ["#818cf8", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#6b7280"];

  const byType: Record<string, { total: number; count: number }> = {};
  for (const p of posts) {
    if (!p.metrics || !p.contentType) continue;
    const ct = p.contentType;
    if (!byType[ct]) byType[ct] = { total: 0, count: 0 };
    byType[ct].total += calcScore(p.metrics);
    byType[ct].count++;
  }

  const data = Object.entries(byType)
    .map(([ct, v]) => ({ type: ct.replace("型", ""), avg: Math.round((v.total / v.count) * 10) / 10, count: v.count }))
    .sort((a, b) => b.avg - a.avg);

  if (data.length === 0) return (
    <div className="flex flex-col items-center justify-center h-40 gap-2">
      <div className="text-2xl">⏳</div>
      <p className="text-xs text-white/30 text-center">
        投稿データ蓄積中...<br />
        <span className="text-[10px] text-white/20">Claude生成後の投稿が蓄積されると表示されます</span>
      </p>
    </div>
  );

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }} />
        <YAxis dataKey="type" type="category" width={60} tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }} />
        <RechartTooltip
          contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
          formatter={(v: number, _: string, entry: any) => [
            `avg ${v}pt (${entry.payload.count}件)`, "エンゲージメント",
          ]}
        />
        <Bar dataKey="avg" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => {
            const colorIdx = typeDef.findIndex((t) => t.startsWith(d.type));
            return <Cell key={i} fill={colors[colorIdx >= 0 ? colorIdx : i % colors.length]} fillOpacity={0.85} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// インプ狙い vs 宣伝 比較
function ImpressionVsAffiliatePanel({ posts }: { posts: Post[] }) {
  const withMetrics = posts.filter((p) => p.metrics);
  const impPosts = withMetrics.filter((p) => p.type === "impression");
  const affPosts = withMetrics.filter((p) => p.type !== "impression");

  const impAvg = impPosts.length > 0
    ? impPosts.reduce((s, p) => s + calcScore(p.metrics), 0) / impPosts.length : null;
  const affAvg = affPosts.length > 0
    ? affPosts.reduce((s, p) => s + calcScore(p.metrics), 0) / affPosts.length : 0;

  // 前半 vs 後半の宣伝投稿スコア推移
  const sorted = [...affPosts].sort((a, b) => new Date(a.postedAt).getTime() - new Date(b.postedAt).getTime());
  const half = Math.floor(sorted.length / 2);
  const beforeAvg = half > 0 ? sorted.slice(0, half).reduce((s, p) => s + calcScore(p.metrics), 0) / half : null;
  const afterAvg  = half > 0 ? sorted.slice(half).reduce((s, p) => s + calcScore(p.metrics), 0) / (sorted.length - half) : null;

  const trend = (beforeAvg !== null && afterAvg !== null)
    ? afterAvg > beforeAvg ? "📈 改善中" : afterAvg < beforeAvg ? "📉 悪化" : "→ 横ばい"
    : "—";
  const trendColor = (beforeAvg !== null && afterAvg !== null)
    ? afterAvg > beforeAvg ? "text-emerald-400" : afterAvg < beforeAvg ? "text-red-400" : "text-white/50"
    : "text-white/50";

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-lg border border-sky-500/30 bg-sky-500/8 p-3">
        <p className="text-[10px] text-sky-400 mb-1">💬 インプ狙い投稿</p>
        <p className="text-xl font-bold text-white">{impAvg !== null ? impAvg.toFixed(1) : "—"}</p>
        <p className="text-[10px] text-white/40 mt-0.5">avg スコア ({impPosts.length}件)</p>
        <p className="text-[10px] text-white/30 mt-1">10:30 / 17:00 JST</p>
      </div>
      <div className="rounded-lg border border-pink-500/30 bg-pink-500/8 p-3">
        <p className="text-[10px] text-pink-400 mb-1">🔗 宣伝投稿（アフィリ）</p>
        <p className="text-xl font-bold text-white">{affAvg.toFixed(1)}</p>
        <p className="text-[10px] text-white/40 mt-0.5">avg スコア ({affPosts.length}件)</p>
        <div className="flex items-center gap-1 mt-1">
          <span className={`text-[10px] font-medium ${trendColor}`}>{trend}</span>
          {beforeAvg !== null && afterAvg !== null && (
            <span className="text-[10px] text-white/25">{beforeAvg.toFixed(1)} → {afterAvg.toFixed(1)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// 時間帯別パフォーマンス（JST）
function HourlyPerformanceChart({ posts }: { posts: Post[] }) {
  const hourStats: Record<number, { total: number; count: number }> = {};
  for (const p of posts) {
    if (!p.metrics) continue;
    const h = (new Date(p.postedAt).getUTCHours() + 9) % 24;
    if (!hourStats[h]) hourStats[h] = { total: 0, count: 0 };
    hourStats[h].total += calcScore(p.metrics);
    hourStats[h].count++;
  }

  const data = Array.from({ length: 24 }, (_, h) => ({
    hour: `${String(h).padStart(2, "0")}`,
    avg: hourStats[h] ? Math.round(hourStats[h].total / hourStats[h].count * 10) / 10 : 0,
    count: hourStats[h]?.count ?? 0,
  })).filter((d) => d.count > 0);

  if (data.length === 0) return (
    <div className="flex items-center justify-center h-32 text-xs text-white/30">データ蓄積中...</div>
  );

  const maxAvg = Math.max(...data.map((d) => d.avg));

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} />
        <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }} />
        <RechartTooltip
          contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
          formatter={(v: number, _: string, entry: any) => [`avg ${v}pt (${entry.payload.count}件)`, "エンゲージメント"]}
          labelFormatter={(l) => `${l}:00 JST`}
        />
        <Bar dataKey="avg" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={d.avg === maxAvg ? "#fbbf24" : "#6366f1"}
              fillOpacity={d.avg === maxAvg ? 1 : 0.6}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// 5型 × スロット種別 クロス集計
function ContentTypeBySlotChart({ posts }: { posts: Post[] }) {
  const slotTypes = ["amateur", "buzz", "random", "sale", "celebrity"];
  const contentTypes5 = ["レビュー", "比較", "ランキング", "失敗回避", "共感", "テンプレート"];
  const colors5 = ["#818cf8", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#6b7280"];

  // スロット × コンテンツ型のクロス集計
  const cross: Record<string, Record<string, number>> = {};
  for (const p of posts) {
    if (!p.metrics || !p.contentType || !slotTypes.includes(p.type)) continue;
    const slot = typeLabel(p.type);
    const ct = p.contentType.replace("型", "");
    if (!cross[slot]) cross[slot] = {};
    cross[slot][ct] = (cross[slot][ct] ?? 0) + calcScore(p.metrics);
  }

  const data = Object.entries(cross).map(([slot, cts]) => ({ slot, ...cts }));
  if (data.length === 0) return (
    <div className="flex items-center justify-center h-32 text-xs text-white/30">データ蓄積中...</div>
  );

  const usedTypes = [...new Set(data.flatMap((d) => Object.keys(d).filter((k) => k !== "slot")))];

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="slot" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }} />
        <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }} />
        <RechartTooltip
          contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
        />
        <Legend wrapperStyle={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }} />
        {usedTypes.map((ct, i) => {
          const colorIdx = contentTypes5.findIndex((t) => t === ct);
          return (
            <Bar key={ct} dataKey={ct} stackId="a" fill={colors5[colorIdx >= 0 ? colorIdx : i % colors5.length]} fillOpacity={0.8} radius={i === usedTypes.length - 1 ? [3, 3, 0, 0] : undefined} />
          );
        })}
      </BarChart>
    </ResponsiveContainer>
  );
}

// 日次評価スケジュール表示
function DailyEvaluationPanel({ strategy }: { strategy: StrategyData | undefined }) {
  const steps = [
    { time: "03:00", icon: "🌙", label: "夜間自律評価開始", detail: "指標取得 → 仮説⑤⑥検証" },
    { time: "毎監視", icon: "🧠", label: "戦略エンジン評価", detail: `間隔: ${strategy?.monitorIntervalHours ?? 6}h / 仮説①〜④` },
    { time: "週月08:00", icon: "📊", label: "週次レポート", detail: "全統計・テンプレート進化サマリー" },
  ];

  return (
    <div className="space-y-2">
      {steps.map((s) => (
        <div key={s.time} className="flex items-center gap-3 p-2.5 rounded-lg bg-white/5 border border-white/8">
          <span className="text-lg shrink-0">{s.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-indigo-300">{s.time} JST</span>
              <span className="text-xs text-white/70">{s.label}</span>
            </div>
            <p className="text-[10px] text-white/40 mt-0.5">{s.detail}</p>
          </div>
          {strategy?.lastEvaluatedAt && s.time === "03:00" && (
            <span className="text-[10px] text-white/25 shrink-0">最終: {fmtDate(strategy.lastEvaluatedAt)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── ウォッチドッグパネル ─────────────────────────────────────────────────────

function WatchdogPanel({ data }: { data: WatchdogData | undefined }) {
  if (!data) return (
    <div className="rounded-xl border border-white/8 bg-white/5 p-4">
      <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">🐕 自己修復ウォッチドッグ</h2>
      <p className="text-xs text-white/30">読み込み中...</p>
    </div>
  );

  const statusCfg = {
    healthy:    { icon: "🟢", label: "正常稼働中",  cls: "border-emerald-500/30 bg-emerald-500/8" },
    issue:      { icon: "🟡", label: "問題検知",    cls: "border-yellow-500/30 bg-yellow-500/8" },
    recovering: { icon: "🔄", label: "回復処理中",  cls: "border-blue-500/30 bg-blue-500/8" },
    failed:     { icon: "🔴", label: "回復失敗",    cls: "border-red-500/30 bg-red-500/8" },
  }[data.status];

  const levelIcon = { info: "ℹ", warn: "⚠", error: "❌", recovery: "✅" };
  const levelCls  = { info: "text-white/50", warn: "text-yellow-400", error: "text-red-400", recovery: "text-emerald-400" };

  return (
    <div className={`rounded-xl border p-4 ${statusCfg.cls}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-base">{statusCfg.icon}</span>
          <h2 className="text-xs font-semibold text-white/70">🐕 自己修復ウォッチドッグ</h2>
          <span className="text-xs text-white/50">{statusCfg.label}</span>
        </div>
        <div className="text-[10px] text-white/30 text-right">
          <div>問題検知: {data.issueCount}回</div>
          <div>自動回復: <span className="text-emerald-400 font-medium">{data.recoveryCount}回</span></div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3 text-[10px]">
        <div className="bg-white/5 rounded p-2">
          <p className="text-white/30 mb-0.5">最終チェック</p>
          <p className="text-white/70">{data.lastCheckAt ? fmtDate(data.lastCheckAt) : "未実行"}</p>
        </div>
        <div className="bg-white/5 rounded p-2">
          <p className="text-white/30 mb-0.5">最終問題検知</p>
          <p className="text-yellow-400">{data.lastIssueAt ? fmtDate(data.lastIssueAt) : "なし"}</p>
        </div>
        <div className="bg-white/5 rounded p-2">
          <p className="text-white/30 mb-0.5">最終自動回復</p>
          <p className="text-emerald-400">{data.lastRecoveryAt ? fmtDate(data.lastRecoveryAt) : "なし"}</p>
        </div>
      </div>
      {data.events.length > 0 && (
        <div>
          <p className="text-[10px] text-white/30 mb-1.5">最新ログ</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {data.events.slice(0, 8).map((ev, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[10px]">
                <span className="shrink-0 text-white/30 font-mono">{fmtDate(ev.at).slice(5)}</span>
                <span className="shrink-0">{levelIcon[ev.level]}</span>
                <span className={levelCls[ev.level]}>{ev.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── メインダッシュボード ─────────────────────────────────────────────────────

function Dashboard() {
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<"overview" | "analysis" | "strategy" | "posts" | "patterns">("overview");

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const { data: status } = useQuery<BotStatus>({
    queryKey: ["botStatus", tick],
    queryFn: () => fetch(`${API}/api/bot/status`).then((r) => r.json()),
    refetchInterval: 30000,
  });
  const { data: postsData } = useQuery<{ posts: Post[] }>({
    queryKey: ["botPosts", tick],
    queryFn: () => fetch(`${API}/api/bot/posts`).then((r) => r.json()),
    refetchInterval: 60000,
  });
  const { data: externalInfo } = useQuery<ExternalInfo>({
    queryKey: ["externalPatterns", tick],
    queryFn: () => fetch(`${API}/api/bot/external-patterns`).then((r) => r.json()),
    refetchInterval: 300000,
  });
  const { data: strategy } = useQuery<StrategyData>({
    queryKey: ["strategy", tick],
    queryFn: () => fetch(`${API}/api/bot/strategy`).then((r) => r.json()),
    refetchInterval: 60000,
  });
  const { data: watchdog } = useQuery<WatchdogData>({
    queryKey: ["watchdog", tick],
    queryFn: () => fetch(`${API}/api/bot/watchdog`).then((r) => r.json()),
    refetchInterval: 60000,
  });

  const posts = postsData?.posts ?? [];
  const stats = status?.stats;
  const postsWithMetrics = posts.filter((p) => p.metrics);
  const totalScore = postsWithMetrics.reduce((s, p) => s + calcScore(p.metrics), 0);
  const avgScore = postsWithMetrics.length > 0 ? (totalScore / postsWithMetrics.length).toFixed(1) : "—";

  // 最高エンゲージメント投稿
  const topPost = postsWithMetrics.length > 0
    ? postsWithMetrics.reduce((best, p) => calcScore(p.metrics) > calcScore(best.metrics) ? p : best)
    : null;

  const TABS = [
    { id: "overview",  label: "概要" },
    { id: "analysis",  label: "📊 分析" },
    { id: "strategy",  label: "🧠 戦略エンジン" },
    { id: "posts",     label: "投稿履歴" },
    { id: "patterns",  label: "外部データ" },
  ] as const;

  // スケジュール（APIから取得、またはデフォルト）
  const schedule = status?.schedule ?? [
    { time: "09:00 JST", type: "amateur",    label: "素人（1件）" },
    { time: "10:30 JST", type: "impression", label: "💬インプ狙い①" },
    { time: "12:00 JST", type: "buzz",       label: "高評価（1件）" },
    { time: "17:00 JST", type: "impression", label: "💬インプ狙い②" },
    { time: "18:00 JST", type: "buzz",       label: "バズ（1件）" },
    { time: "21:00 JST", type: "random",     label: "ランダム（1件）" },
    { time: "23:00 JST", type: "sale",       label: "セール（1件）" },
  ];

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      {/* Header */}
      <header className="border-b border-white/8 bg-[#0d1529]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">🔞</span>
            <div>
              <h1 className="text-sm font-bold leading-tight">FANZA X Bot</h1>
              <p className="text-[11px] text-white/40">{status?.account ?? "読み込み中..."}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[11px] text-white/40 hidden sm:block">
              稼働: {status ? formatUptime(status.uptime) : "—"}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-[11px] text-emerald-400 font-medium">LIVE</span>
            </div>
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-5xl mx-auto px-4 flex gap-0 border-t border-white/8 overflow-x-auto scrollbar-none">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
                tab === t.id
                  ? "border-indigo-400 text-indigo-300"
                  : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5 space-y-5">

        {/* ════════════════════ 概要タブ ════════════════════ */}
        {tab === "overview" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="総投稿数" value={stats?.totalPosts ?? "—"} sub="全期間" />
              <StatCard label="今週の投稿" value={stats?.postsLast7Days ?? "—"} sub="過去7日間" />
              <StatCard label="累計いいね" value={(stats?.totalLikes ?? 0).toLocaleString()} accent="text-rose-400" />
              <StatCard label="平均エンゲージメント" value={avgScore} sub="スコア / 投稿" accent="text-indigo-400" />
            </div>

            {/* エンゲージメント推移 */}
            <div className="rounded-xl border border-white/8 bg-white/5 p-4">
              <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">エンゲージメント推移（直近20件）</h2>
              <EngagementChart posts={posts} />
            </div>

            {/* スケジュール + 最新投稿 */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-white/8 bg-white/5 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider">投稿スケジュール</h2>
                  <span className="text-[10px] text-white/30">8本/日</span>
                </div>
                <div className="space-y-1">
                  {schedule.map((s) => (
                    <div key={s.time} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
                      <span className="text-xs font-mono text-indigo-300">{s.time}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${typeBadge(s.type)}`}>
                        {s.label}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between py-1.5 border-b border-white/5">
                    <span className="text-xs font-mono text-orange-300">20:00 JST</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${typeBadge("celebrity")}`}>芸能人似（動的）</span>
                  </div>
                </div>
                <p className="text-[10px] text-white/20 mt-2">💬 = リンクなし・共感型 / 🔗 = アフィリリンク付き</p>
              </div>

              <div className="space-y-4">
                {/* 最高エンゲージメント投稿 */}
                {topPost && (
                  <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
                    <h2 className="text-xs font-semibold text-yellow-400/70 uppercase tracking-wider mb-2">🏆 最高エンゲージメント投稿</h2>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${typeBadge(topPost.type)}`}>
                        {typeLabel(topPost.type)}
                      </span>
                      {topPost.contentType && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50">{topPost.contentType}</span>
                      )}
                      <span className="text-[10px] text-yellow-400 ml-auto font-bold">スコア {calcScore(topPost.metrics)}</span>
                    </div>
                    <p className="text-xs text-white/60 line-clamp-2">{topPost.item.title}</p>
                    {topPost.metrics && (
                      <div className="flex gap-3 mt-2 text-[10px] text-white/40">
                        <span>❤ {topPost.metrics.like_count}</span>
                        <span>🔁 {topPost.metrics.retweet_count}</span>
                        {topPost.metrics.bookmark_count != null && <span>🔖 {topPost.metrics.bookmark_count}</span>}
                      </div>
                    )}
                  </div>
                )}

                {/* 最新投稿 */}
                <div className="rounded-xl border border-white/8 bg-white/5 p-4">
                  <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">最新投稿</h2>
                  {stats?.lastPostedAt ? (
                    <div className="space-y-2">
                      <div>
                        <p className="text-[10px] text-white/40 mb-0.5">投稿日時</p>
                        <p className="text-sm font-medium">{fmtDate(stats.lastPostedAt)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-white/40 mb-0.5">作品タイトル</p>
                        <p className="text-xs text-white/70 line-clamp-2">{stats.lastPostTitle}</p>
                      </div>
                      <a
                        href={`https://twitter.com/${(status?.account ?? "").replace("@", "")}`}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:underline"
                      >
                        🐦 Xで確認 →
                      </a>
                    </div>
                  ) : (
                    <p className="text-xs text-white/30 py-4 text-center">投稿データなし</p>
                  )}
                </div>
              </div>
            </div>

            <WatchdogPanel data={watchdog} />
          </>
        )}

        {/* ════════════════════ 分析タブ ════════════════════ */}
        {tab === "analysis" && (
          <>
            {/* サマリーカード */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="指標取得済み" value={postsWithMetrics.length} sub={`/ ${posts.length}件`} accent="text-indigo-400" />
              <StatCard
                label="最高スコア投稿"
                value={topPost ? calcScore(topPost.metrics) : "—"}
                sub={topPost?.contentType ?? "—"}
                accent="text-yellow-400"
              />
              <StatCard
                label="インプ投稿数"
                value={posts.filter((p) => p.type === "impression").length}
                sub="10:30 / 17:00 JST"
                accent="text-sky-400"
              />
              <StatCard
                label="5型データあり"
                value={posts.filter((p) => p.contentType).length}
                sub={`/ ${posts.length}件`}
                accent="text-emerald-400"
              />
            </div>

            {/* 5型コンテンツ エンゲージメントランキング */}
            <div className="rounded-xl border border-white/8 bg-white/5 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider">
                  仮説⑤ — 5型コンテンツ エンゲージメントランキング
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300">自動検証中</span>
              </div>
              <p className="text-[10px] text-white/30 mb-3">
                Claude がレビュー/比較/ランキング/失敗回避/共感 のどの型で書いた投稿が最も伸びるかを自動測定
              </p>
              <ContentType5Chart posts={posts} />
              {/* 型説明 */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 mt-3">
                {[
                  { name: "レビュー型",    desc: "「正直に言う」「確かめた」",         color: "text-indigo-400" },
                  { name: "比較型",        desc: "「〜よりも」「比較した結果」",       color: "text-emerald-400" },
                  { name: "ランキング型",  desc: "「今一番」「個人的1位」",            color: "text-yellow-400" },
                  { name: "失敗回避型",    desc: "「知らないと損」「注意して」",       color: "text-pink-400" },
                  { name: "共感型",        desc: "「あるある」「これわかる?」",        color: "text-purple-400" },
                  { name: "シナリオ型",    desc: "背徳ミニストーリー / 女優名明記",    color: "text-orange-400" },
                  { name: "テンプレート型", desc: "静的テンプレート使用",              color: "text-gray-400" },
                ].map((t) => (
                  <div key={t.name} className="flex items-start gap-1.5 bg-white/5 rounded p-1.5">
                    <span className={`text-[10px] font-medium ${t.color} shrink-0`}>{t.name}</span>
                    <span className="text-[9px] text-white/30">{t.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* インプ狙い vs 宣伝 比較 */}
            <div className="rounded-xl border border-white/8 bg-white/5 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider">
                  仮説⑥ — インプ狙い vs 宣伝投稿 比較
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300">自動検証中</span>
              </div>
              <p className="text-[10px] text-white/30 mb-3">
                リンクなし「有益・共感型」投稿の追加が、宣伝投稿のエンゲージメントを改善しているか測定
              </p>
              <ImpressionVsAffiliatePanel posts={posts} />
              <p className="text-[10px] text-white/20 mt-2">
                ※「宣伝投稿の推移」は前半 vs 後半の平均スコア比較。インプ投稿追加後の改善を検出します。
              </p>
            </div>

            {/* 時間帯別パフォーマンス */}
            <div className="rounded-xl border border-white/8 bg-white/5 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider">
                  仮説④ — 時間帯別エンゲージメント（JST）
                </h2>
                <span className="text-[10px] text-white/30">🏆 = 最高スロット</span>
              </div>
              <HourlyPerformanceChart posts={posts} />
            </div>

            {/* スロット × 5型 クロス集計 */}
            <div className="rounded-xl border border-white/8 bg-white/5 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider">
                  スロット × コンテンツ型 クロス集計
                </h2>
                <span className="text-[10px] text-white/30">積み上げ = 累計スコア</span>
              </div>
              <p className="text-[10px] text-white/30 mb-3">
                どのスロット × どの型の組み合わせが最も稼いでいるか
              </p>
              <ContentTypeBySlotChart posts={posts} />
            </div>

            {/* 自律評価サイクル */}
            <div className="rounded-xl border border-white/8 bg-white/5 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider">自律改善サイクル</h2>
                {strategy?.lastEvaluatedAt && (
                  <span className="text-[10px] text-white/30">最終評価: {fmtDate(strategy.lastEvaluatedAt)}</span>
                )}
              </div>
              <DailyEvaluationPanel strategy={strategy} />
            </div>
          </>
        )}

        {/* ════════════════════ 戦略エンジンタブ ════════════════════ */}
        {tab === "strategy" && strategy && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="監視間隔" value={`${strategy.monitorIntervalHours}h`} sub="外部データ収集" accent="text-indigo-300" />
              <StatCard label="評価サイクル数" value={strategy.cycleStats.totalCycles} sub="累計" />
              <StatCard label="動的テンプレート" value={strategy.dynamicTemplates.count} sub={`進化 ${strategy.dynamicTemplates.evolutionCount}回`} accent="text-emerald-400" />
              <StatCard
                label="平均新規パターン"
                value={strategy.cycleStats.avgNewPatterns.toFixed(1)}
                sub="件/サイクル"
              />
            </div>

            {/* コンテンツ重み */}
            <div className="rounded-xl border border-white/8 bg-white/5 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider">コンテンツ種別 重み（自動調整）</h2>
                <span className="text-[10px] text-white/30">高いほど優先度UP</span>
              </div>
              <TypeWeightBar weights={strategy.typeWeights} />
              <div className="flex flex-wrap gap-2 mt-2">
                {Object.entries(strategy.typeWeights).map(([type, w]) => (
                  <div key={type} className={`text-xs px-2 py-0.5 rounded-full border ${typeBadge(type)}`}>
                    {typeLabel(type)}: {w.toFixed(2)}
                  </div>
                ))}
              </div>
            </div>

            {/* 仮説一覧 */}
            <div className="rounded-xl border border-white/8 bg-white/5 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider">
                  仮説検証ステータス ({strategy.hypotheses.length}件)
                </h2>
                <div className="flex items-center gap-2 text-[10px] text-white/30">
                  <span>⏳ 検証中</span>
                  <span>✅ 確認済</span>
                  <span>🔧 調整済</span>
                  <span>❌ 否定</span>
                </div>
              </div>
              <div className="space-y-2">
                {strategy.hypotheses.length === 0 ? (
                  <p className="text-xs text-white/30 text-center py-4">最初のサイクル後に表示されます</p>
                ) : (
                  strategy.hypotheses.map((h) => <HypothesisCard key={h.id} h={h} />)
                )}
              </div>
            </div>

            {/* 意思決定ログ */}
            <div className="rounded-xl border border-white/8 bg-white/5 p-4">
              <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">意思決定ログ</h2>
              <div className="space-y-2">
                {strategy.recentDecisions.length === 0 ? (
                  <p className="text-xs text-white/30 text-center py-4">ログがありません</p>
                ) : (
                  strategy.recentDecisions.map((d, i) => (
                    <div key={i} className="p-3 rounded-lg bg-white/5 border border-white/8">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-white/40">サイクル #{d.cycle} • {fmtDate(d.at)}</span>
                      </div>
                      <ul className="space-y-0.5">
                        {d.decisions.map((dec, j) => (
                          <li key={j} className="text-xs text-white/60 flex items-start gap-1.5">
                            <span className="text-indigo-400 shrink-0">→</span>
                            <span>{dec}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            </div>

            {strategy.lastEvaluatedAt && (
              <p className="text-[10px] text-white/20 text-right">最終評価: {fmtDate(strategy.lastEvaluatedAt)}</p>
            )}
          </>
        )}

        {/* ════════════════════ 投稿履歴タブ ════════════════════ */}
        {tab === "posts" && (
          <div className="rounded-xl border border-white/8 bg-white/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider">投稿履歴</h2>
              <span className="text-[10px] text-white/30">{posts.length}件</span>
            </div>
            {posts.length === 0 ? (
              <p className="text-xs text-white/30 text-center py-8">投稿データがありません</p>
            ) : (
              <div className="space-y-2">
                {posts.map((post) => {
                  const sc = calcScore(post.metrics);
                  return (
                    <div key={post.tweetId} className="p-3 rounded-lg bg-white/5 border border-white/8 flex gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${typeBadge(post.type)}`}>
                            {typeLabel(post.type)}
                          </span>
                          {post.contentType && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50">
                              {post.contentType}
                            </span>
                          )}
                          <span className="text-[10px] text-white/40">{fmtDate(post.postedAt)}</span>
                          {post.metrics && (
                            <span className="text-[10px] text-indigo-300 ml-auto">スコア {sc}</span>
                          )}
                        </div>
                        <p className="text-xs text-white/60 line-clamp-2">{post.item.title}</p>
                        {post.metrics ? (
                          <div className="flex gap-3 mt-1.5 text-[10px] text-white/40">
                            <span>❤ {post.metrics.like_count}</span>
                            <span>🔁 {post.metrics.retweet_count}</span>
                            {post.metrics.bookmark_count != null && <span>🔖 {post.metrics.bookmark_count}</span>}
                            {post.metrics.reply_count != null && <span>💬 {post.metrics.reply_count}</span>}
                          </div>
                        ) : (
                          <p className="text-[10px] text-white/25 mt-1">指標未取得</p>
                        )}
                      </div>
                      <a
                        href={`https://twitter.com/i/web/status/${post.tweetId}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-[10px] text-indigo-400 hover:underline shrink-0 mt-1"
                      >
                        Xで見る →
                      </a>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ════════════════════ 外部データタブ ════════════════════ */}
        {tab === "patterns" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatCard label="収集パターン数" value={externalInfo?.count ?? 0} sub="総保存件数" />
              <StatCard label="収集クエリ数" value={externalInfo?.queries?.length ?? 0} />
              <StatCard
                label="最終収集"
                value={externalInfo?.lastRefreshedAt ? fmtDate(externalInfo.lastRefreshedAt) : "未収集"}
              />
            </div>

            {externalInfo?.queries && externalInfo.queries.length > 0 && (
              <div className="rounded-xl border border-white/8 bg-white/5 p-4">
                <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">収集クエリ</h2>
                <div className="flex flex-wrap gap-1.5">
                  {externalInfo.queries.map((q) => (
                    <span key={q} className="text-xs bg-blue-500/10 border border-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full">{q}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-white/8 bg-white/5 p-4">
              <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">
                上位パターン（テンプレート進化の元データ）
              </h2>
              {!externalInfo || externalInfo.topPatterns.length === 0 ? (
                <p className="text-xs text-white/30 text-center py-6">
                  データ収集中... 次のサイクルまでお待ちください
                </p>
              ) : (
                <div className="space-y-3">
                  {externalInfo.topPatterns.slice(0, 10).map((p, i) => (
                    <div key={p.tweetId} className="p-3 rounded-lg bg-white/5 border border-white/8">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] text-blue-400 font-mono">#{i + 1} スコア {p.score}</span>
                        <div className="flex gap-2 text-[10px] text-white/40">
                          <span>❤ {p.like_count}</span>
                          <span>🔁 {p.retweet_count}</span>
                          {p.bookmark_count > 0 && <span>🔖 {p.bookmark_count}</span>}
                        </div>
                      </div>
                      <p className="text-xs text-white/60 line-clamp-3 whitespace-pre-wrap">{p.text}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[10px] text-white/25">{p.source}</span>
                        <a
                          href={`https://twitter.com/i/web/status/${p.tweetId}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-[10px] text-indigo-400 hover:underline"
                        >
                          Xで見る →
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      <footer className="border-t border-white/8 mt-8 py-3 text-center text-[10px] text-white/20">
        FANZA X Bot — 自律稼働中 · 30秒ごとに自動更新 🤖
      </footer>
    </div>
  );
}

// ─── ルーティング ─────────────────────────────────────────────────────────────

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={BASE}>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route component={NotFound} />
          </Switch>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
