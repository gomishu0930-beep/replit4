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
interface AccountSnapshot {
  recordedAt: string;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  note?: string;
}
interface ManualObservation {
  id: string;
  recordedAt: string;
  category: "engagement" | "product" | "safe-post" | "other";
  source?: string;
  observation: string;
  hypothesis?: string;
  priority: "high" | "medium" | "low";
}
interface ResearchSession {
  id: string;
  topic: string;
  result: string;
  model: string;
  startedAt: string;
  completedAt: string;
}
type Speaker = "user" | "gpt" | "claude" | "grok" | "system";
type Assignee = "user" | "others" | "ai";
interface MeetingMessage {
  role: "user" | "assistant";
  speaker: Speaker;
  content: string;
  at: string;
}
interface DecisionCandidate {
  id: string;
  text: string;
  category: MeetingDirective["category"];
  priority: MeetingDirective["priority"];
  rationale: string;
  assignee: Assignee;
  successCriteria?: string;
}
interface MeetingSession {
  id: string;
  title: string;
  createdAt: string;
  messages: MeetingMessage[];
  researchId?: string;
  decisionCandidates?: DecisionCandidate[];
}
interface DirectiveExecution {
  at: string;
  actionType: string;
  summary: string;
  changes: string[];
  success: boolean;
}
interface GoalKPI {
  metric: string;
  label: string;
  target: number | string;
  unit: string;
  higherIsBetter: boolean;
  actual: number | null;
  achieved: boolean | null;
}
interface ManualPostFeedback {
  id: string;
  generatedAt: string;
  weekStart: string;
  weekEnd: string;
  tweetCount: number;
  avgEngagement: number;
  topTweet: { text: string; likes: number; rt: number };
  analysis: string;
  suggestions: string[];
  hookVariety: string[];
}
interface WeekGoal {
  week: string;
  start: string;
  end: string;
  slot: string;
  kpis: GoalKPI[];
  note?: string;
  status: "upcoming" | "current" | "past";
  postCount: number;
}
interface GateCondition {
  metric: string;
  label: string;
  target: number | string;
  unit: string;
  actual: number | null;
  achieved: boolean | null;
}
interface GateGoal {
  id: string;
  date: string;
  label: string;
  conditions: GateCondition[];
  status: "upcoming" | "today" | "past";
}
interface GoalData {
  goal: { base: number; stretch: number; period: string; startDate: string };
  weeks: WeekGoal[];
  gates: GateGoal[];
}
interface QuickConfigResult {
  execution: { actionType: string; summary: string; changes: string[]; success: boolean };
}
interface MeetingDirective {
  id: string;
  text: string;
  category: "strategy" | "content" | "timing" | "recovery" | "other";
  assignee: Assignee;
  priority: "high" | "medium" | "low";
  status: "active" | "completed" | "cancelled";
  source: string;
  platform?: "x" | "threads";
  createdAt: string;
  updatedAt: string;
  executionLog?: DirectiveExecution[];
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

// ─── 手動投稿フィードバックパネル ────────────────────────────────────────────

function ManualFeedbackPanel({ feedbacks, onRun }: { feedbacks: ManualPostFeedback[]; onRun: () => void }) {
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const API = import.meta.env.VITE_API_URL ?? "";

  async function handleRun() {
    setRunning(true);
    setRunMsg(null);
    try {
      const res = await fetch(`${API}/api/bot/manual-feedback/run`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setRunMsg("✅ 生成完了！ページを更新してください");
        onRun();
      } else {
        setRunMsg(`⚠ ${data.reason ?? "生成失敗"}`);
      }
    } catch (e: any) {
      setRunMsg(`❌ エラー: ${e.message}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white/80">📝 手動投稿 週次フィードバック</h2>
          <p className="text-xs text-white/40 mt-0.5">毎週月曜08:00 JSTに自動生成。直近7日の手動ツイートをClaudeが分析します。</p>
        </div>
        <button
          onClick={handleRun}
          disabled={running}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 transition-colors disabled:opacity-50"
        >
          {running ? "分析中..." : "今すぐ生成"}
        </button>
      </div>
      {runMsg && <p className="text-xs text-yellow-300">{runMsg}</p>}

      {feedbacks.length === 0 ? (
        <div className="rounded-xl border border-white/8 bg-white/5 p-6 text-center">
          <p className="text-sm text-white/40">フィードバックはまだありません。</p>
          <p className="text-xs text-white/25 mt-1">「今すぐ生成」ボタンか、月曜08:00 JSTの自動実行をお待ちください。</p>
        </div>
      ) : (
        <div className="space-y-4">
          {feedbacks.map((fb) => (
            <div key={fb.id} className="rounded-xl border border-white/8 bg-white/5 p-4 space-y-3">
              {/* ヘッダー */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-indigo-300">
                  {fb.weekStart} 〜 {fb.weekEnd}
                </span>
                <span className="text-[10px] text-white/30">
                  生成: {new Date(fb.generatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} JST
                </span>
              </div>

              {/* サマリー数値 */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-white/5 border border-white/8 p-2 text-center">
                  <p className="text-[10px] text-white/40">分析ツイート数</p>
                  <p className="text-lg font-bold text-white">{fb.tweetCount}<span className="text-xs font-normal text-white/40 ml-1">件</span></p>
                </div>
                <div className="rounded-lg bg-white/5 border border-white/8 p-2 text-center">
                  <p className="text-[10px] text-white/40">平均エンゲージメント</p>
                  <p className="text-lg font-bold text-indigo-300">{fb.avgEngagement}<span className="text-xs font-normal text-white/40 ml-1">pt</span></p>
                </div>
              </div>

              {/* フック型 */}
              {fb.hookVariety.length > 0 && (
                <div>
                  <p className="text-[10px] text-white/40 mb-1.5">使ったフック型</p>
                  <div className="flex flex-wrap gap-1">
                    {fb.hookVariety.map((h, i) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300">{h}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* 全体評価 */}
              <div className="rounded-lg bg-white/4 border border-white/6 p-3">
                <p className="text-[10px] text-white/40 mb-1">全体評価</p>
                <p className="text-xs text-white/75 leading-relaxed">{fb.analysis}</p>
              </div>

              {/* ベスト投稿 */}
              <div className="rounded-lg bg-emerald-500/8 border border-emerald-500/20 p-3">
                <p className="text-[10px] text-emerald-400/70 mb-1">今週のベスト投稿</p>
                <p className="text-xs text-white/70 whitespace-pre-wrap leading-relaxed line-clamp-3">{fb.topTweet.text}</p>
                <p className="text-[10px] text-white/35 mt-1.5">❤️ {fb.topTweet.likes}　🔁 {fb.topTweet.rt}</p>
              </div>

              {/* 改善提案 */}
              {fb.suggestions.length > 0 && (
                <div>
                  <p className="text-[10px] text-white/40 mb-1.5">改善提案</p>
                  <ol className="space-y-1">
                    {fb.suggestions.map((s, i) => (
                      <li key={i} className="flex gap-2 text-xs text-white/65">
                        <span className="text-yellow-400/70 shrink-0">{i + 1}.</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── メインダッシュボード ─────────────────────────────────────────────────────

function Dashboard() {
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<"overview" | "features" | "analysis" | "strategy" | "posts" | "patterns" | "research" | "meeting" | "tasks" | "goals" | "manual-fb" | "rebrandly" | "algo">("overview");
  const [platform, setPlatform] = useState<"x" | "threads">("x");

  // mainTab は tab から自動導出（既存の setTab 呼び出しをそのまま使える）
  const mainTab = (() => {
    if (tab === "overview") return "home";
    if (tab === "posts" || tab === "manual-fb") return "posts";
    if (tab === "algo" || tab === "analysis" || tab === "rebrandly") return "analysis";
    if (tab === "strategy" || tab === "research" || tab === "patterns") return "strategy";
    return "admin"; // tasks, meeting, goals, features
  })();

  const [obsForm, setObsForm] = useState({ category: "engagement", observation: "", source: "", hypothesis: "", priority: "medium" });
  const [obsSubmitting, setObsSubmitting] = useState(false);

  // 会議室ステート
  const [researchTopic, setResearchTopic] = useState("");
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchResult, setResearchResult] = useState<ResearchSession | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [meetingSession, setMeetingSession] = useState<MeetingSession | null>(null);
  const [meetingInput, setMeetingInput] = useState("");
  const [meetingLoading, setMeetingLoading] = useState(false);
  const [trialoguRound, setTrialoguRound] = useState(0);  // 現在処理中のラウンド（0=非実行中）
  const [meetingCreating, setMeetingCreating] = useState(false);

  // 決定事項ステート
  const [dirModal, setDirModal] = useState<{ text: string; source: string } | null>(null);
  const [dirForm, setDirForm] = useState({ category: "strategy" as MeetingDirective["category"], priority: "medium" as MeetingDirective["priority"], assignee: "user" as Assignee });
  const [dirSaving, setDirSaving] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);

  // クイック設定モーダル
  const [qcOpen, setQcOpen] = useState(false);
  const [qcInput, setQcInput] = useState("");
  const [qcLoading, setQcLoading] = useState(false);
  const [qcResult, setQcResult] = useState<QuickConfigResult | null>(null);

  // 送信モード・決定抽出
  const [sendMode, setSendMode] = useState<"gpt" | "claude" | "trialogue">("trialogue");
  const [extractLoading, setExtractLoading] = useState(false);
  const [candidates, setCandidates] = useState<DecisionCandidate[]>([]);

  // ── タスクリスト ────────────────────────────────────────────────────────────
  type TaskFreq = "daily" | "weekly";
  type TaskAssignee = "user" | "ai";
  interface TaskItem {
    id: string;
    title: string;
    description: string;
    frequency: TaskFreq;
    assignee: TaskAssignee;
    category: string;
    scheduledTime?: string;
    scheduledDay?: string;
    emoji: string;
    completionKey: string;
    completed: boolean;
    completedAt?: string;
    completedBy?: "user" | "bot";
    isDirective?: boolean;
  }
  interface TaskList { daily: TaskItem[]; weekly: TaskItem[]; dateKey: string; weekKey: string; }
  const [tasks, setTasks] = useState<TaskList | null>(null);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [taskToggling, setTaskToggling] = useState<Set<string>>(new Set());

  async function fetchTasks() {
    try {
      const res = await fetch(`${API}/api/bot/tasks`);
      if (res.ok) setTasks(await res.json());
    } catch { /* silent */ }
  }

  async function toggleTaskItem(item: TaskItem) {
    if (item.assignee === "ai") return; // AI タスクは手動変更不可
    const newDone = !item.completed;
    setTaskToggling((s) => new Set(s).add(item.completionKey));
    try {
      const res = await fetch(`${API}/api/bot/tasks/${encodeURIComponent(item.completionKey)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: newDone }),
      });
      if (res.ok) await fetchTasks();
    } finally {
      setTaskToggling((s) => { const ns = new Set(s); ns.delete(item.completionKey); return ns; });
    }
  }

  // タスクタブを開いたとき or 30秒ごとにフェッチ
  useEffect(() => {
    if (tab === "tasks") { setTasksLoading(true); fetchTasks().finally(() => setTasksLoading(false)); }
  }, [tab, tick]);

  // Q&Aラウンド管理（5ラウンドディベート後）
  const [debateCompleted, setDebateCompleted] = useState(false);
  const [qaRoundsLeft, setQaRoundsLeft] = useState(2);
  const [qaInput, setQaInput] = useState("");
  const [qaLoading, setQaLoading] = useState(false);
  // Grokスコア採点（会議ごとにリセット）
  const [cumulativeScores, setCumulativeScores] = useState<{ gpt: number; claude: number }>({ gpt: 0, claude: 0 });
  const [grokVerdict, setGrokVerdict] = useState<{ directive?: any; winner?: string } | null>(null);

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
  const { data: goalsData } = useQuery<GoalData>({
    queryKey: ["goals", tick],
    queryFn: () => fetch(`${API}/api/bot/goals`).then((r) => r.json()),
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
  const { data: snapshotsData, refetch: refetchSnapshots } = useQuery<{ snapshots: AccountSnapshot[] }>({
    queryKey: ["snapshots"],
    queryFn: () => fetch(`${API}/api/bot/snapshots`).then((r) => r.json()),
    refetchInterval: 3600000,
  });
  const { data: obsData, refetch: refetchObs } = useQuery<{ observations: ManualObservation[] }>({
    queryKey: ["observations"],
    queryFn: () => fetch(`${API}/api/bot/observations`).then((r) => r.json()),
    refetchInterval: 60000,
  });
  const { data: directivesData, refetch: refetchDirectives } = useQuery<{ directives: MeetingDirective[] }>({
    queryKey: ["directives"],
    queryFn: () => fetch(`${API}/api/bot/meeting/directives`).then((r) => r.json()),
    refetchInterval: 30000,
  });
  const { data: manualFbData, refetch: refetchManualFb } = useQuery<{ feedbacks: ManualPostFeedback[] }>({
    queryKey: ["manual-feedback"],
    queryFn: () => fetch(`${API}/api/bot/manual-feedback`).then((r) => r.json()),
    refetchInterval: 300000,
  });

  // 自律モードステート
  const { data: autonomyData } = useQuery<{
    autonomyGrantedAt: string;
    isAutonomous: boolean;
    features: Array<{ key: string; label: string; schedule: string; enabled: boolean }>;
  }>({
    queryKey: ["autonomy-status"],
    queryFn: () => fetch(`${API}/api/bot/autonomy/status`).then((r) => r.json()),
    staleTime: Infinity,
  });
  const [autoExecRunning, setAutoExecRunning] = useState(false);
  const [autoExecResult, setAutoExecResult] = useState<{
    total: number; executed: number; succeeded: number; skipped: number;
    results: Array<{ id: string; text: string; actionType: string; result: string; success: boolean }>;
  } | null>(null);
  const [meetingRunning, setMeetingRunning] = useState(false);
  const [meetingResult, setMeetingResult] = useState<{
    totalDecisions: number;
    autoExecuted: Array<{ text: string; result: string; success: boolean }>;
    manualItems: Array<{ text: string; category: string; priority: string; rationale: string }>;
  } | null>(null);
  const [showAiDirectives, setShowAiDirectives] = useState(false);

  const [algoRunning, setAlgoRunning] = useState(false);
  const [algoKbOpen, setAlgoKbOpen] = useState(false);
  const [algoNewsSearching, setAlgoNewsSearching] = useState(false);
  const [algoDiscoveryTab, setAlgoDiscoveryTab] = useState<'pending' | 'adopted' | 'all'>('pending');
  const { data: algoKbData } = useQuery<{
    version: string;
    sources: string[];
    scoring: Array<{ rule: string; detail: string; source: string; implication: string }>;
    pipeline: Array<{ rule: string; detail: string; source: string; implication: string }>;
    nsfw: Array<{ rule: string; detail: string; source: string; implication: string }>;
    uncertain: Array<{ rule: string; detail: string; source: string }>;
  }>({
    queryKey: ["algo-kb"],
    queryFn: () => fetch(`${API}/api/bot/algo-kb`).then((r) => r.json()),
    staleTime: Infinity,
  });
  const { data: discoveryData, refetch: refetchDiscoveries } = useQuery<{
    meta: { lastSearchAt: string | null; pendingCount: number; adoptedCount: number };
    discoveries: Array<{
      id: string; discoveredAt: string; title: string; detail: string;
      sourceUrl: string; sourceDesc: string;
      confidence: 'confirmed' | 'likely' | 'rumored';
      category: 'scoring' | 'pipeline' | 'nsfw' | 'other';
      status: 'pending' | 'adopted' | 'rejected';
      reviewNote?: string;
      reviewedAt?: string;
    }>;
  }>({
    queryKey: ["algo-discoveries"],
    queryFn: () => fetch(`${API}/api/bot/algo-discoveries`).then((r) => r.json()),
    refetchInterval: 300000,
  });

  const { data: algoData, refetch: refetchAlgo } = useQuery<{
    latest: {
      generatedAt: string;
      sampleSize: number;
      briefing: string;
      stats: {
        byType: Array<{ type: string; avgImp: number; avgEng: number; count: number }>;
        byHour: Array<{ hour: number; avgImp: number; count: number }>;
        correlations: { textLength: number; emojiCount: number; lineCount: number; hasQuestion: number; hasNumber: number };
        topPosts: Array<{ tweetId: string; postedAt: string; type: string; impressions: number; engScore: number }>;
      };
      discussion: { claudeHypothesis: string; o3Challenge: string; claudeSynthesis: string };
    } | null;
    stats: {
      byType: Array<{ type: string; avgImp: number; avgEng: number; count: number }>;
      byHour: Array<{ hour: number; avgImp: number; count: number }>;
      correlations: { textLength: number; emojiCount: number; lineCount: number; hasQuestion: number; hasNumber: number };
      topPosts: Array<{ tweetId: string; postedAt: string; type: string; impressions: number; engScore: number }>;
      sampleSize: number;
    };
  }>({
    queryKey: ["algo-insights"],
    queryFn: () => fetch(`${API}/api/bot/algo-insights`).then((r) => r.json()),
    refetchInterval: 600000,
  });

  const { data: rebrandlyData, refetch: refetchRebrandly, isRefetching: rebrandlySyncing } = useQuery<{
    links: Array<{ id: string; slashtag: string; destination: string; title: string; clicks: number; lastSyncedAt: string }>;
    lastSyncedAt: string | null;
  }>({
    queryKey: ["rebrandly"],
    queryFn: () => fetch(`${API}/api/bot/rebrandly`).then((r) => r.json()),
    refetchInterval: 600000,
  });
  const activeDirectives = (directivesData?.directives ?? []).filter((d) => d.status === "active");

  const posts = postsData?.posts ?? [];
  const stats = status?.stats;
  const postsWithMetrics = posts.filter((p) => p.metrics);
  const totalScore = postsWithMetrics.reduce((s, p) => s + calcScore(p.metrics), 0);
  const avgScore = postsWithMetrics.length > 0 ? (totalScore / postsWithMetrics.length).toFixed(1) : "—";

  // 最高エンゲージメント投稿
  const topPost = postsWithMetrics.length > 0
    ? postsWithMetrics.reduce((best, p) => calcScore(p.metrics) > calcScore(best.metrics) ? p : best)
    : null;

  // セクション別サブタブ（ボトムナビ選択に応じて切替）
  const SECTION_SUBTABS: Record<string, Array<{ id: string; label: string }>> = {
    home:     [],
    posts:    [{ id: "posts", label: "📋 履歴" }, { id: "manual-fb", label: "📝 手動FB" }],
    analysis: [{ id: "algo", label: "📡 アルゴ解析" }, { id: "analysis", label: "📊 パフォーマンス" }, { id: "rebrandly", label: "🔗 リンク計測" }],
    strategy: [{ id: "strategy", label: "🧠 戦略エンジン" }, { id: "research", label: "🔬 回復研究" }, { id: "patterns", label: "🌐 外部データ" }],
    admin:    [{ id: "tasks", label: "✅ タスク" }, { id: "meeting", label: "🤝 会議室" }, { id: "goals", label: "🎯 目標" }, { id: "features", label: "🔧 機能" }],
  };
  const currentSubTabs = SECTION_SUBTABS[mainTab] ?? [];

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
            {/* プラットフォームトグル */}
            <div className="flex items-center bg-white/5 border border-white/10 rounded-lg p-0.5">
              <button
                onClick={() => setPlatform("x")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${
                  platform === "x"
                    ? "bg-[#1d9bf0] text-white shadow-sm"
                    : "text-white/40 hover:text-white/60"
                }`}
              >
                𝕏
              </button>
              <button
                onClick={() => setPlatform("threads")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${
                  platform === "threads"
                    ? "bg-gradient-to-r from-[#833AB4] via-[#E1306C] to-[#F77737] text-white shadow-sm"
                    : "text-white/40 hover:text-white/60"
                }`}
              >
                🪡
              </button>
            </div>
            <div>
              <h1 className="text-sm font-bold leading-tight">
                {platform === "threads" ? (
                  <>🪡 Threads — {mainTab === "home" ? "ホーム" : mainTab === "posts" ? "投稿管理" : mainTab === "analysis" ? "分析" : mainTab === "strategy" ? "戦略" : "管理"}</>
                ) : (
                  <>
                    {mainTab === "home"     && "🏠 ホーム"}
                    {mainTab === "posts"    && "📝 投稿管理"}
                    {mainTab === "analysis" && "📊 分析"}
                    {mainTab === "strategy" && "🧠 戦略"}
                    {mainTab === "admin"    && "⚙️ 管理"}
                  </>
                )}
              </h1>
              <p className="text-[11px] text-white/40">
                {platform === "threads" ? "Amazon/楽天 アフィリエイト" : (status?.account ?? "読み込み中...")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[11px] text-white/40 hidden sm:block">
              稼働: {status ? formatUptime(status.uptime) : "—"}
            </div>
            <button
              onClick={() => { setQcOpen(true); setQcResult(null); setQcInput(""); }}
              className="px-2.5 py-1 rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-[11px] font-medium hover:bg-indigo-500/20 transition-colors"
              title="クイック設定"
            >
              ⚙️ 設定
            </button>
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-[11px] text-emerald-400 font-medium">LIVE</span>
            </div>
          </div>
        </div>
        {/* セクション内サブタブ（セクションに応じて切替） */}
        {currentSubTabs.length > 0 && (
          <div className="max-w-5xl mx-auto px-4 flex gap-1 border-t border-white/8 py-1.5 overflow-x-auto scrollbar-none">
            {currentSubTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id as any)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
                  tab === t.id
                    ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                    : "text-white/40 hover:text-white/70 hover:bg-white/5"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5 pb-24 space-y-5">

        {/* ════ Threads ビュー ════ */}
        {platform === "threads" && (
          <div className="space-y-5">
            {/* ── Threads ホーム ── */}
            {mainTab === "home" && (
              <>
                {/* 接続ステータス */}
                <div className="rounded-2xl border border-orange-500/30 bg-orange-500/5 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🪡</span>
                      <div>
                        <p className="text-sm font-bold text-orange-300">Threads 未接続</p>
                        <p className="text-[10px] text-orange-300/60">API設定が必要です</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setTab("tasks")}
                      className="px-3 py-1.5 rounded-lg bg-orange-500/20 border border-orange-500/30 text-orange-300 text-[11px] font-medium hover:bg-orange-500/30 transition-colors"
                    >
                      ⚙️ 設定へ
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { step: "1", label: "Threads API", status: "未設定", color: "red" },
                      { step: "2", label: "Amazon Associates", status: "未設定", color: "red" },
                      { step: "3", label: "楽天アフィリ", status: "未設定", color: "red" },
                    ].map(s => (
                      <div key={s.step} className="p-2.5 rounded-lg bg-white/5 border border-white/8 text-center">
                        <p className="text-[10px] text-white/40 mb-0.5">STEP {s.step}</p>
                        <p className="text-[11px] font-semibold text-white/70">{s.label}</p>
                        <p className="text-[10px] text-red-400/80 mt-0.5">{s.status}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 運用戦略サマリー */}
                <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
                  <h2 className="text-xs font-semibold text-purple-300 uppercase tracking-wider mb-3">📋 確定戦略（AI会議より）</h2>
                  <div className="space-y-2.5">
                    {[
                      { icon: "🎯", label: "マネタイズ", value: "Amazon/楽天 芸能人コンテンツ（写真集・DVD・グッズ）" },
                      { icon: "📅", label: "投稿頻度", value: "1日1〜2件（X投稿とは独立して運用）" },
                      { icon: "✍️", label: "コンテンツ型", value: "芸能人レビュー・ランキング・新作速報（アフィリリンク直接掲載）" },
                      { icon: "🤝", label: "X連携", value: "独立運用（Xへの誘導なし・Threads単独でコンバート）" },
                      { icon: "🤖", label: "AI生成", value: "既存のGPT/Claude/Grokパイプラインをそのまま活用" },
                    ].map(item => (
                      <div key={item.label} className="flex gap-3">
                        <span className="text-base shrink-0">{item.icon}</span>
                        <div>
                          <p className="text-[10px] text-white/40">{item.label}</p>
                          <p className="text-xs text-white/80">{item.value}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 予想収益 */}
                <div className="rounded-xl border border-white/8 bg-white/3 p-4">
                  <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">📈 収益シミュレーション</h2>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    {[
                      { period: "1ヶ月後", followers: "〜100", revenue: "¥1,000〜3,000", color: "text-white/50" },
                      { period: "3ヶ月後", followers: "〜500", revenue: "¥5,000〜15,000", color: "text-yellow-300/80" },
                      { period: "6ヶ月後", followers: "〜2,000", revenue: "¥20,000〜50,000", color: "text-emerald-300/80" },
                    ].map(s => (
                      <div key={s.period} className="p-3 rounded-lg bg-white/5 border border-white/8">
                        <p className="text-[10px] text-white/40 mb-1">{s.period}</p>
                        <p className="text-[10px] text-white/60">フォロワー {s.followers}</p>
                        <p className={`text-xs font-bold mt-1 ${s.color}`}>{s.revenue}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[9px] text-white/25 mt-2 text-center">※Amazon/楽天アフィリ 平均クリック率2%・成約率5%・単価¥3,000で試算</p>
                </div>
              </>
            )}

            {/* ── Threads 投稿管理 ── */}
            {mainTab === "posts" && (
              <>
                <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
                  <h2 className="text-xs font-semibold text-purple-300 uppercase tracking-wider mb-3">✍️ Threads投稿生成（プレビュー）</h2>
                  <p className="text-[10px] text-white/40 mb-4">API接続後、以下のテンプレートで自動投稿が開始されます。</p>
                  <div className="space-y-3">
                    {[
                      {
                        type: "📸 写真集レビュー型",
                        example: "【{芸能人名}最新写真集レビュー】\n\n全{ページ数}ページ、{撮影場所}ロケが圧巻。\n特に{特徴的なシーン}のカットは必見。\n\nファンなら絶対持っておきたい一冊です📖\n\n▶ Amazon予約・購入はプロフのリンクから",
                        color: "border-blue-500/30 bg-blue-500/5",
                      },
                      {
                        type: "🏆 ランキング型",
                        example: "【2026年 買ってよかった芸能人グッズTOP3】\n\n1位: {商品名} - {理由}\n2位: {商品名} - {理由}\n3位: {商品名} - {理由}\n\n詳細リンクはプロフから👆",
                        color: "border-emerald-500/30 bg-emerald-500/5",
                      },
                      {
                        type: "⚡ 新作速報型",
                        example: "🚨 速報: {芸能人名}の新作{コンテンツ種別}が発売！\n\n発売日: {日付}\n価格: ¥{価格}\n\n予約開始してます→ リンクはプロフから",
                        color: "border-orange-500/30 bg-orange-500/5",
                      },
                    ].map(t => (
                      <div key={t.type} className={`p-3 rounded-lg border ${t.color}`}>
                        <p className="text-[10px] font-semibold text-white/70 mb-2">{t.type}</p>
                        <pre className="text-[10px] text-white/50 whitespace-pre-wrap font-sans leading-relaxed">{t.example}</pre>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-white/8 bg-white/3 p-4">
                  <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">📅 投稿スケジュール案</h2>
                  <div className="space-y-2">
                    {[
                      { time: "07:00 JST", type: "写真集レビュー", note: "朝の通勤時間帯狙い" },
                      { time: "12:30 JST", type: "ランキング・おすすめ", note: "昼休み狙い" },
                      { time: "21:00 JST", type: "新作速報・セール情報", note: "夜のリラックスタイム" },
                    ].map(s => (
                      <div key={s.time} className="flex items-center gap-3 p-2.5 rounded-lg bg-white/5">
                        <span className="text-[11px] font-mono text-indigo-300 w-20 shrink-0">{s.time}</span>
                        <span className="text-xs text-white/70 flex-1">{s.type}</span>
                        <span className="text-[10px] text-white/30">{s.note}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-white/30 mt-3">※ AI会議での方針確定後、自動スケジューラーに組み込まれます</p>
                </div>
              </>
            )}

            {/* ── Threads 分析 ── */}
            {mainTab === "analysis" && (
              <div className="rounded-xl border border-white/8 bg-white/3 p-4 text-center py-12">
                <p className="text-3xl mb-3">📊</p>
                <p className="text-sm font-semibold text-white/60 mb-2">API接続後に分析が開始されます</p>
                <p className="text-[11px] text-white/35 mb-4">計測予定: インプレッション・アフィリリンククリック数・コンバージョン数・収益</p>
                <button
                  onClick={() => setTab("tasks")}
                  className="px-4 py-2 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-medium hover:bg-purple-500/30 transition-colors"
                >
                  ⚙️ 管理画面でAPI接続する
                </button>
              </div>
            )}

            {/* ── Threads 戦略（会議室へ直行） ── */}
            {mainTab === "strategy" && (
              <div className="space-y-4">
                {/* 会議室直行バナー */}
                <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-2xl">🤝</div>
                    <div>
                      <p className="text-sm font-bold text-white">Threads 方針決定会議</p>
                      <p className="text-[11px] text-white/40">GPT × Claude × Grok の3者が議論し、アカウント運営方針を決定します</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-white/60 mb-4 leading-relaxed">
                    どんなジャンルを扱うか・どんなトーンで投稿するか・どんなキャラクター設定にするか——これらをAI3者が事実ベースで議論し、<span className="text-white font-semibold">あなたが最終決定</span>する会議を開きます。
                  </p>
                  <button
                    onClick={() => setTab("meeting")}
                    className="w-full py-3 rounded-xl bg-indigo-500/30 border border-indigo-500/40 text-indigo-200 text-sm font-bold hover:bg-indigo-500/40 transition-colors"
                  >
                    🪡 Threads 方針決定会議を開く →
                  </button>
                </div>

                {/* 議題候補 */}
                <div className="rounded-xl border border-white/8 bg-white/3 p-4">
                  <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">📋 今すぐ議論できる議題</h3>
                  <div className="space-y-2">
                    {[
                      { label: "アカウントのジャンル・ニッチ決定", desc: "グラビア・アイドル・俳優・女優のどれを中心にするか", urgent: true },
                      { label: "投稿トーンとキャラクター設定", desc: "個人感あり vs まとめ系 / キャラ設定の有無", urgent: true },
                      { label: "マネタイズ戦略の優先順位", desc: "Amazon vs 楽天 / 商品カテゴリ（写真集・DVD・グッズ）", urgent: false },
                      { label: "投稿スケジュール・頻度", desc: "1日何件・何時に投稿するか", urgent: false },
                    ].map((item, i) => (
                      <button
                        key={i}
                        onClick={() => setTab("meeting")}
                        className="w-full flex items-start gap-3 p-3 rounded-lg bg-white/4 border border-white/6 hover:bg-white/8 transition-colors text-left"
                      >
                        {item.urgent && <span className="text-[9px] font-bold text-red-400 shrink-0 mt-0.5 px-1 py-0.5 bg-red-500/15 rounded">未決定</span>}
                        {!item.urgent && <span className="text-[9px] font-bold text-white/30 shrink-0 mt-0.5 px-1 py-0.5 bg-white/5 rounded">要検討</span>}
                        <div>
                          <p className="text-[11px] font-semibold text-white/80">{item.label}</p>
                          <p className="text-[10px] text-white/40">{item.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Threads 管理（API取得ロードマップ） ── */}
            {mainTab === "admin" && (
              <>
                {/* ── タイムライン俯瞰 ── */}
                <div className="rounded-xl border border-white/10 bg-white/3 p-4">
                  <h2 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-4">🗺️ API取得ロードマップ — 全体タイムライン</h2>
                  <div className="relative">
                    {/* タイムラインバー */}
                    <div className="flex items-center gap-0 mb-2 text-[9px] text-white/30 pl-[72px]">
                      {["今日", "D3", "W1", "W2", "W3", "W4", "M2", "M3"].map(d => (
                        <div key={d} className="flex-1 text-center">{d}</div>
                      ))}
                    </div>
                    <div className="space-y-2.5">
                      {/* 楽天 */}
                      <div className="flex items-center gap-2">
                        <div className="w-[68px] shrink-0 text-right">
                          <span className="text-[10px] font-semibold text-emerald-400">楽天</span>
                        </div>
                        <div className="flex-1 h-5 relative rounded-full bg-white/5 overflow-hidden">
                          <div className="absolute left-0 top-0 h-full w-[12%] bg-emerald-500/60 rounded-full flex items-center pl-2">
                            <span className="text-[9px] text-white/90 whitespace-nowrap">登録</span>
                          </div>
                          <div className="absolute left-[12%] top-0 h-full w-[25%] bg-emerald-500/30 rounded-r-full flex items-center pl-2">
                            <span className="text-[9px] text-white/60 whitespace-nowrap">即日承認</span>
                          </div>
                          <div className="absolute left-[37%] top-0 h-full w-[63%] bg-emerald-500/15 flex items-center pl-2">
                            <span className="text-[9px] text-white/40 whitespace-nowrap">✅ 運用開始（今日から可能）</span>
                          </div>
                        </div>
                      </div>
                      {/* Amazon */}
                      <div className="flex items-center gap-2">
                        <div className="w-[68px] shrink-0 text-right">
                          <span className="text-[10px] font-semibold text-yellow-400">Amazon</span>
                        </div>
                        <div className="flex-1 h-5 relative rounded-full bg-white/5 overflow-hidden">
                          <div className="absolute left-0 top-0 h-full w-[12%] bg-yellow-500/60 rounded-full flex items-center pl-2">
                            <span className="text-[9px] text-white/90 whitespace-nowrap">申請</span>
                          </div>
                          <div className="absolute left-[12%] top-0 h-full w-[26%] bg-yellow-500/30 flex items-center pl-2">
                            <span className="text-[9px] text-white/60 whitespace-nowrap">審査 1〜2週</span>
                          </div>
                          <div className="absolute left-[38%] top-0 h-full w-[62%] bg-yellow-500/15 flex items-center pl-2">
                            <span className="text-[9px] text-white/40 whitespace-nowrap">✅ 運用開始（90日以内に3件売上必須）</span>
                          </div>
                        </div>
                      </div>
                      {/* Threads */}
                      <div className="flex items-center gap-2">
                        <div className="w-[68px] shrink-0 text-right">
                          <span className="text-[10px] font-semibold text-purple-400">Threads</span>
                        </div>
                        <div className="flex-1 h-5 relative rounded-full bg-white/5 overflow-hidden">
                          <div className="absolute left-0 top-0 h-full w-[12%] bg-purple-500/60 rounded-full flex items-center pl-2">
                            <span className="text-[9px] text-white/90 whitespace-nowrap">Dev登録</span>
                          </div>
                          <div className="absolute left-[12%] top-0 h-full w-[13%] bg-purple-500/40 flex items-center pl-2">
                            <span className="text-[9px] text-white/60 whitespace-nowrap">アプリ</span>
                          </div>
                          <div className="absolute left-[25%] top-0 h-full w-[37%] bg-purple-500/25 flex items-center pl-2">
                            <span className="text-[9px] text-white/50 whitespace-nowrap">API申請〜承認（最長M2）</span>
                          </div>
                          <div className="absolute left-[62%] top-0 h-full w-[38%] bg-purple-500/15 flex items-center pl-2">
                            <span className="text-[9px] text-white/40 whitespace-nowrap">✅ 自動投稿開始</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── 申請前の共通事前準備 ── */}
                <div className="rounded-xl border border-white/12 bg-white/4 p-4">
                  <h2 className="text-xs font-semibold text-white/70 uppercase tracking-wider mb-3">📋 申請前に必ず済ませること（全API共通）</h2>
                  <div className="space-y-2">
                    {[
                      { check: "Threadsアカウントを公開設定にする（鍵アカは審査NG）", critical: true },
                      { check: "Threadsに3〜5件の投稿を先に入れておく（空アカは即落ち）", critical: true },
                      { check: "プロフィールに「エンタメ情報・芸能人グッズ紹介」と書く", critical: false },
                      { check: "Threadsのプロフィール画像を設定する（信頼度UP）", critical: false },
                      { check: "本名または運営者名を確認できる電話番号を手元に準備", critical: false },
                    ].map((item, i) => (
                      <div key={i} className="flex items-start gap-2.5 p-2 rounded-lg bg-white/3">
                        <span className={`text-sm shrink-0 mt-0.5 ${item.critical ? "text-red-400" : "text-white/40"}`}>
                          {item.critical ? "🔴" : "⬜"}
                        </span>
                        <p className={`text-[11px] ${item.critical ? "text-white/85 font-medium" : "text-white/60"}`}>{item.check}</p>
                        {item.critical && <span className="text-[9px] text-red-400 shrink-0 font-bold mt-0.5">必須</span>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── 楽天アフィリエイト ── */}
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold flex items-center justify-center">1</span>
                      <div>
                        <p className="text-xs font-bold text-emerald-300">楽天アフィリエイト — 今日 15分で完了</p>
                        <p className="text-[10px] text-emerald-300/50">審査なし・即日承認・報酬1〜3% — 最も簡単</p>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[9px] font-bold">最優先・今日</span>
                  </div>

                  <div className="space-y-2 mb-3">
                    {[
                      { day: "STEP1", action: "affiliate.rakuten.co.jp にアクセス → 「新規登録（無料）」", url: "https://affiliate.rakuten.co.jp/", note: "楽天会員アカウントでそのままログインOK", done: false },
                      { day: "STEP2", action: "サイト/SNS登録: 種別「SNS」→ URL欄に threads.net/@suguhalove0419 を入力", url: "", note: "「@」なしのURLで入力すること", done: false },
                      { day: "STEP3", action: "サイト説明: 下のコピペ文をそのまま貼り付け", url: "", note: "↓ コピペ欄あり", done: false },
                      { day: "STEP4", action: "承認メール受信（通常即日〜数時間）→ affiliateId をメモ", url: "", note: "メールが来なければ迷惑メールを確認", done: false },
                      { day: "STEP5", action: "楽天市場商品検索APIキーも申請（写真集・DVDリンク自動生成に使用）", url: "https://webservice.rakuten.co.jp/", note: "RapidSSLアカウントで申請。別途必要", done: false },
                    ].map((s, i) => (
                      <div key={i} className="flex gap-3 p-2.5 rounded-lg bg-white/4 border border-white/6">
                        <span className="text-[9px] font-bold text-emerald-400/90 w-12 shrink-0 mt-0.5 text-center">{s.day}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-white/80">{s.action}</p>
                          {s.url && <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-indigo-400 hover:text-indigo-300 underline">{s.url}</a>}
                          <p className="text-[10px] text-white/35 mt-0.5">{s.note}</p>
                        </div>
                        <span className="text-base shrink-0">{s.done ? "✅" : "⬜"}</span>
                      </div>
                    ))}
                  </div>

                  {/* コピペ文 */}
                  <div className="p-3 rounded-lg bg-emerald-900/30 border border-emerald-500/30 mb-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-semibold text-emerald-300">📋 サイト説明欄コピペ文（そのまま貼るだけ）</p>
                    </div>
                    <p className="text-[11px] text-emerald-100/80 leading-relaxed font-mono bg-black/20 rounded p-2 select-all">
                      Threadsにて芸能人・エンターテインメント関連の情報を発信しています。写真集・DVD・グッズなどの商品情報を紹介し、楽天市場の商品リンクを掲載してフォロワーの購買をサポートします。コンテンツはAIを活用して毎日更新し、スパムのない有益な情報提供を行います。
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <p className="text-[10px] font-semibold text-emerald-300 mb-1.5">⚠️ 維持条件（重要）</p>
                      <p className="text-[10px] text-emerald-300/70 leading-relaxed">承認後 <span className="font-bold text-white">90日以内</span>に1件以上の成約が必要。未達成の場合は資格失効。楽天の商品を自分で購入してもNG（本人購入は無効）。</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <p className="text-[10px] font-semibold text-emerald-300 mb-1.5">💰 狙い目カテゴリ</p>
                      <p className="text-[10px] text-emerald-300/70 leading-relaxed">写真集: 3〜5%<br/>DVD: 2〜4%<br/>Blu-ray: 3%<br/>グッズ: 1〜3%<br/>ファッション: 3〜5%</p>
                    </div>
                  </div>
                </div>

                {/* ── Amazon アソシエイト ── */}
                <div className="rounded-xl border border-yellow-500/25 bg-yellow-500/5 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-yellow-500/30 border border-yellow-500/40 text-yellow-300 text-[10px] font-bold flex items-center justify-center">2</span>
                      <div>
                        <p className="text-xs font-bold text-yellow-300">Amazon アソシエイト — 今日申請・審査1〜2週間</p>
                        <p className="text-[10px] text-yellow-300/50">報酬3〜10% — 申請書の書き方が審査合否を決める</p>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-yellow-500/20 border border-yellow-500/30 text-yellow-300 text-[9px] font-bold">要申請</span>
                  </div>

                  {/* 事前準備チェックリスト */}
                  <div className="p-3 rounded-lg bg-yellow-500/8 border border-yellow-500/20 mb-3">
                    <p className="text-[10px] font-semibold text-yellow-300 mb-2">⚡ 申請前チェック（これができていないと落ちる）</p>
                    <div className="space-y-1.5">
                      {[
                        "Threadsに最低3件の投稿がある（0件アカは100%落ちる）",
                        "Threadsプロフィールが「公開」になっている",
                        "プロフィール文に活動内容が書いてある",
                        "Amazonアカウントに電話番号が登録済み",
                      ].map((c, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-yellow-400 text-[10px]">□</span>
                          <p className="text-[10px] text-yellow-100/70">{c}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2 mb-3">
                    {[
                      { day: "STEP1", action: "affiliate.amazon.co.jp → 「アカウントを作成」", url: "https://affiliate.amazon.co.jp/", note: "既存Amazonアカウントでサインイン", done: false },
                      { day: "STEP2", action: "ウェブサイト一覧: 「SNS/ブログ」→ threads.net/@suguhalove0419 を追加", url: "", note: "複数登録可。Threadsを必ず含める", done: false },
                      { day: "STEP3", action: "「ウェブサイトまたはモバイルアプリの目的」: 下のコピペ文を使用", url: "", note: "↓ 審査通過率が変わる重要欄", done: false },
                      { day: "STEP4", action: "トラフィック獲得方法: 「SNS投稿・フォロワーへの直接紹介」と記入", url: "", note: "「SEO」「広告」は書かない", done: false },
                      { day: "STEP5", action: "Amazonから電話確認コードが届く → 4桁入力して申請完了", url: "", note: "携帯番号を使うこと（固定電話は失敗多い）", done: false },
                      { day: "審査中", action: "申請後すぐにAmazonリンクを使った投稿を3件Threadsに上げる", url: "", note: "「サイトにコンテンツがない」で落ちるのを防ぐ", done: false },
                      { day: "承認後", action: "180日以内に3件の紹介料発生が必要（未達で資格失効）", url: "", note: "楽天成約後にAmazonにも誘導する戦略が有効", done: false },
                    ].map((s, i) => (
                      <div key={i} className="flex gap-3 p-2.5 rounded-lg bg-white/4 border border-white/6">
                        <span className="text-[9px] font-bold text-yellow-400/90 w-12 shrink-0 mt-0.5 text-center">{s.day}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-white/80">{s.action}</p>
                          {s.url && <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-indigo-400 hover:text-indigo-300 underline">{s.url}</a>}
                          <p className="text-[10px] text-white/35 mt-0.5">{s.note}</p>
                        </div>
                        <span className="text-base shrink-0">{s.done ? "✅" : "⬜"}</span>
                      </div>
                    ))}
                  </div>

                  {/* Amazon コピペ文 */}
                  <div className="p-3 rounded-lg bg-yellow-900/20 border border-yellow-500/30 mb-3">
                    <p className="text-[10px] font-semibold text-yellow-300 mb-2">📋 「ウェブサイトの目的」コピペ文（重要：これをそのまま貼る）</p>
                    <p className="text-[11px] text-yellow-100/80 leading-relaxed font-mono bg-black/20 rounded p-2 select-all">
                      Threadsにて芸能人・エンターテインメントに関する情報を発信するアカウントを運営しています。写真集・DVD・Blu-ray・グッズなどのAmazon商品を紹介し、購入リンクを掲載することで収益を得ることを目的としています。AIを活用したコンテンツ生成により毎日更新し、フォロワーに価値ある商品情報を届けます。スパムや虚偽情報は一切掲載しません。
                    </p>
                  </div>

                  <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
                    <p className="text-[10px] font-semibold text-red-300 mb-1">🚫 審査落ちの主な原因（避けること）</p>
                    <div className="space-y-1">
                      {[
                        "申請時点でThreadsに投稿が0件 → 必ず先に投稿する",
                        "説明文が短すぎる（50文字以下）→ 上のコピペ文を使う",
                        "「収益目的ではない」と書く → 正直に書く方が通る",
                        "同一IPで複数アカウント申請 → 1アカウントのみ",
                      ].map((r, i) => (
                        <p key={i} className="text-[10px] text-red-300/70 flex items-start gap-1.5">
                          <span className="shrink-0">✗</span>{r}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ── Threads API ── */}
                <div className="rounded-xl border border-purple-500/25 bg-purple-500/5 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-purple-500/30 border border-purple-500/40 text-purple-300 text-[10px] font-bold flex items-center justify-center">3</span>
                      <div>
                        <p className="text-xs font-bold text-purple-300">Threads API (Meta) — 並行して申請・最難関</p>
                        <p className="text-[10px] text-purple-300/50">承認まで1〜8週間 — 自動投稿の根幹。英語記述が必須</p>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 text-[9px] font-bold">並行申請</span>
                  </div>

                  {/* 事前準備 */}
                  <div className="p-3 rounded-lg bg-purple-500/8 border border-purple-500/20 mb-3">
                    <p className="text-[10px] font-semibold text-purple-300 mb-2">⚡ 申請前に準備するもの</p>
                    <div className="space-y-1.5">
                      {[
                        { item: "Facebookアカウント（Meta開発者登録に必須）", critical: true },
                        { item: "プライバシーポリシーページのURL（要作成：無料サービス可）", critical: true },
                        { item: "アプリのスクリーンショット（ダッシュボードのスクショでOK）", critical: false },
                        { item: "英語のユースケース説明文（↓コピペ欄あり）", critical: true },
                      ].map((c, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <span className={`text-[10px] shrink-0 ${c.critical ? "text-red-400" : "text-purple-400/60"}`}>{c.critical ? "🔴" : "□"}</span>
                          <p className="text-[10px] text-purple-100/75">{c.item}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2 mb-3">
                    {[
                      { day: "STEP1", action: "developers.facebook.com → 「マイアプリ」→「アプリを作成」", url: "https://developers.facebook.com/", note: "種類: 「その他」→ タイプ: 「ビジネス」を選択", done: false },
                      { day: "STEP2", action: "アプリ名: 「ThreadsAutoPost」など英語名で作成", url: "", note: "日本語名は審査が遅れる場合あり", done: false },
                      { day: "STEP3", action: "左メニュー「製品を追加」→「Threads API」を追加", url: "https://developers.facebook.com/docs/threads", note: "ページが表示されない場合はキャッシュクリア", done: false },
                      { day: "STEP4", action: "「アプリレビュー」→「権限とリクエスト」→ threads_content_publish を申請", url: "", note: "「高度なアクセス」を選択。下の英語文を使う", done: false },
                      { day: "STEP5", action: "プライバシーポリシーURL: privacypolicygenerator.info で無料作成 → URLを貼る", url: "https://www.privacypolicygenerator.info/", note: "URLがないと申請が進まない", done: false },
                      { day: "STEP6", action: "スクリーンショット添付: ダッシュボードのスクショを3枚追加", url: "", note: "「アプリの動作がわかる画像」が必要", done: false },
                      { day: "審査中", action: "Metaからの追加質問メールに24時間以内に英語で返信", url: "", note: "無視すると申請キャンセルになる", done: false },
                      { day: "承認後", action: "長期アクセストークン（60日有効）を取得 → システムに設定", url: "", note: "期限切れ前に更新スクリプトを組む", done: false },
                    ].map((s, i) => (
                      <div key={i} className="flex gap-3 p-2.5 rounded-lg bg-white/4 border border-white/6">
                        <span className="text-[9px] font-bold text-purple-400/90 w-12 shrink-0 mt-0.5 text-center">{s.day}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-white/80">{s.action}</p>
                          {s.url && <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-indigo-400 hover:text-indigo-300 underline">{s.url}</a>}
                          <p className="text-[10px] text-white/35 mt-0.5">{s.note}</p>
                        </div>
                        <span className="text-base shrink-0">{s.done ? "✅" : "⬜"}</span>
                      </div>
                    ))}
                  </div>

                  {/* 英語コピペ文 */}
                  <div className="p-3 rounded-lg bg-purple-900/25 border border-purple-500/30 mb-3">
                    <p className="text-[10px] font-semibold text-purple-300 mb-2">📋 英語ユースケース説明文（STEP4のフォームにそのまま貼る）</p>
                    <p className="text-[11px] text-purple-100/80 leading-relaxed font-mono bg-black/20 rounded p-2 select-all text-[10px]">
                      {`I am building an automated content publishing bot for Threads. The bot automatically generates entertainment and celebrity-related content (photo book reviews, DVD recommendations, product rankings) using AI, and publishes 1-2 posts per day to my Threads account. The purpose is to share valuable entertainment information with followers and monetize through Amazon/Rakuten affiliate links. All content is AI-generated, unique, and spam-free. The threads_content_publish permission is required to post content programmatically without manual intervention.`}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
                      <p className="text-[10px] font-semibold text-purple-300 mb-1.5">🔑 必要な権限</p>
                      <p className="text-[10px] text-purple-300/70 font-mono leading-relaxed">threads_content_publish<br/>threads_read_replies<br/>threads_manage_insights</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
                      <p className="text-[10px] font-semibold text-purple-300 mb-1.5">⏱️ 却下された場合</p>
                      <p className="text-[10px] text-purple-300/70 leading-relaxed">理由を確認 → 説明を補強して再申請可能。2〜3回の再申請で通るケースが多い。</p>
                    </div>
                  </div>
                </div>

                {/* ── 今すぐやること（優先アクション） ── */}
                <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/5 p-4">
                  <h2 className="text-xs font-semibold text-indigo-300 uppercase tracking-wider mb-3">🚀 今日やること（優先順・所要時間付き）</h2>
                  <div className="space-y-2">
                    {[
                      { priority: "1st", time: "15分", label: "Threadsプロフィール整備 + 3件投稿（全申請の前提）", color: "text-white", bg: "bg-white/8 border-white/15" },
                      { priority: "2nd", time: "15分", label: "楽天アフィリエイト登録（コピペ文使用で即承認）", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
                      { priority: "3rd", time: "30分", label: "Amazon アソシエイト申請（コピペ文使用・審査待ち）", color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/20" },
                      { priority: "4th", time: "60分", label: "Meta開発者登録 + Threads APIアプリ作成 + 英語文申請", color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20" },
                    ].map(a => (
                      <div key={a.priority} className={`flex items-center gap-3 p-3 rounded-lg border ${a.bg}`}>
                        <span className={`text-[10px] font-bold ${a.color} w-8 shrink-0`}>{a.priority}</span>
                        <span className="text-[10px] text-white/30 w-8 shrink-0">{a.time}</span>
                        <p className="text-[11px] text-white/80">{a.label}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-white/30 mt-3 text-center">全API承認後、AIが自動でThreadsに投稿 + アフィリリンク挿入が開始されます</p>
                </div>
              </>
            )}
          </div>
        )}

        {/* ════ X コンテンツ（platform === 'x' のときのみ表示。ただし会議室は両プラットフォームで表示）════ */}
        <div className={platform === "threads" && tab !== "meeting" ? "hidden" : ""}>

        {/* ════════════════════ 概要タブ ════════════════════ */}
        {tab === "overview" && (
          <>
            {/* 🤖 自律モードパネル */}
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🤖</span>
                  <div>
                    <h2 className="text-sm font-bold text-emerald-300">自律モード: 完全委任</h2>
                    <p className="text-[10px] text-white/40">
                      {autonomyData?.autonomyGrantedAt
                        ? `権限付与: ${new Date(autonomyData.autonomyGrantedAt).toLocaleDateString("ja-JP")}`
                        : "権限確認中..."}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      setMeetingRunning(true);
                      setMeetingResult(null);
                      try {
                        const res = await fetch(`${API}/api/bot/autonomy/run-meeting`, { method: "POST" });
                        const data = await res.json();
                        if (data.ok) setMeetingResult(data.result);
                      } finally { setMeetingRunning(false); }
                    }}
                    disabled={meetingRunning || autoExecRunning}
                    className="px-3 py-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs font-semibold hover:bg-indigo-500/30 transition-colors disabled:opacity-50"
                    title="GPT×Claude×Grokが自動的に会議を開き、決定を実行します（約5分）"
                  >
                    {meetingRunning ? "会議中..." : "🤝 AI会議"}
                  </button>
                  <button
                    onClick={async () => {
                      setAutoExecRunning(true);
                      setAutoExecResult(null);
                      try {
                        const res = await fetch(`${API}/api/bot/autonomy/run-directives`, { method: "POST" });
                        const data = await res.json();
                        if (data.ok) setAutoExecResult(data.result);
                      } finally { setAutoExecRunning(false); }
                    }}
                    disabled={autoExecRunning || meetingRunning}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
                  >
                    {autoExecRunning ? "実行中..." : "▶ 指令実行"}
                  </button>
                </div>
              </div>

              {/* 自律機能リスト */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(autonomyData?.features ?? [
                  { label: "週次AI自律会議", schedule: "月曜 04:00 JST", enabled: true },
                  { label: "会議室決定の自動実行", schedule: "毎朝 07:30 JST", enabled: true },
                  { label: "アルゴ推奨の自動適用", schedule: "日曜 23:30 JST", enabled: true },
                  { label: "A/Bテスト自動判定", schedule: "W2終了後 月曜 09:00", enabled: true },
                ]).map((f) => (
                  <div key={f.label} className="bg-white/3 rounded-lg p-2.5 border border-white/8">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                      <span className="text-[11px] font-medium text-white/80">{f.label}</span>
                    </div>
                    <span className="text-[10px] text-white/35">{f.schedule}</span>
                  </div>
                ))}
              </div>

              {/* 会議結果 */}
              {meetingRunning && (
                <div className="mt-1 bg-indigo-900/20 rounded-lg p-3 border border-indigo-500/20">
                  <div className="flex items-center gap-2 text-xs text-indigo-300">
                    <span className="animate-spin">⚙️</span>
                    <span>GPT × Claude × Grok が会議中です（約5分かかります）...</span>
                  </div>
                </div>
              )}
              {meetingResult && (
                <div className="mt-1 bg-indigo-900/20 rounded-lg p-3 space-y-2 border border-indigo-500/20">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-white/60">決定事項: <strong className="text-white">{meetingResult.totalDecisions}件</strong></span>
                    <span className="text-emerald-400">AI自動実行: {meetingResult.autoExecuted.filter(r => r.success).length}件</span>
                    {meetingResult.manualItems.length > 0 && (
                      <span className="text-rose-400 font-semibold">要確認: {meetingResult.manualItems.length}件</span>
                    )}
                  </div>
                  {meetingResult.autoExecuted.slice(0, 3).map((r, i) => (
                    <div key={i} className={`text-[10px] flex items-start gap-1.5 ${r.success ? "text-emerald-300" : "text-amber-300"}`}>
                      <span>{r.success ? "✅" : "⚠"}</span>
                      <span className="line-clamp-1">{r.text.slice(0, 50)}</span>
                    </div>
                  ))}
                  {meetingResult.manualItems.slice(0, 2).map((m, i) => (
                    <div key={i} className="text-[10px] flex items-start gap-1.5 text-rose-300">
                      <span>👤</span>
                      <span className="line-clamp-1">{m.text.slice(0, 50)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 指令実行結果 */}
              {autoExecResult && (
                <div className="mt-1 bg-black/20 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-white/60">処理: <strong className="text-white">{autoExecResult.total}件</strong></span>
                    <span className="text-emerald-400">成功: <strong>{autoExecResult.succeeded}</strong></span>
                    <span className="text-white/40">手動: {autoExecResult.skipped}</span>
                  </div>
                  {autoExecResult.results.slice(0, 4).map((r, i) => (
                    <div key={i} className={`text-[10px] flex items-start gap-1.5 ${r.success ? "text-emerald-300" : r.actionType === "no-op" ? "text-white/30" : "text-amber-300"}`}>
                      <span>{r.success ? "✅" : r.actionType === "no-op" ? "↩" : "⚠"}</span>
                      <span className="line-clamp-1">{r.text.slice(0, 45)}…</span>
                      <span className="text-white/30 flex-shrink-0">({r.result.slice(0, 20)})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 👤 あなたの確認が必要なタスク（user担当のみ表示） */}
            {(() => {
              const userDirectives = activeDirectives.filter(d => d.assignee === 'user');
              const aiDirectives   = activeDirectives.filter(d => d.assignee !== 'user');
              const catColor: Record<string, string> = {
                strategy: "text-violet-300 border-violet-500/30 bg-violet-500/10",
                content:  "text-blue-300 border-blue-500/30 bg-blue-500/10",
                timing:   "text-amber-300 border-amber-500/30 bg-amber-500/10",
                recovery: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
                other:    "text-white/50 border-white/10 bg-white/5",
              };
              const priIcon: Record<string, string> = { high: "🔴", medium: "🟡", low: "🟢" };
              return (
                <>
                  {/* ユーザー確認必要タスク */}
                  {userDirectives.length > 0 && (
                    <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-bold text-rose-300 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
                          あなたの確認が必要 ({userDirectives.length}件)
                        </h2>
                        <button onClick={() => setTab("meeting")} className="text-[10px] text-rose-400/60 hover:text-rose-300 transition-colors">
                          会議室で確認 →
                        </button>
                      </div>
                      <div className="space-y-2.5">
                        {userDirectives.map((d) => (
                          <div key={d.id} className="flex items-start gap-2.5 bg-white/3 rounded-lg p-2.5 border border-white/8">
                            <span className="shrink-0 mt-0.5 text-sm">{priIcon[d.priority]}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-white/90 leading-relaxed font-medium">{d.text}</p>
                              <div className="flex items-center gap-2 mt-1.5">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${catColor[d.category] ?? catColor.other}`}>{d.category}</span>
                                <span className="text-[10px] text-white/30">{d.source}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* AI自律実行中の指令（折りたたみ） */}
                  {aiDirectives.length > 0 && (
                    <div className="rounded-xl border border-white/8 bg-white/2 p-3">
                      <button
                        onClick={() => setShowAiDirectives(v => !v)}
                        className="w-full flex items-center justify-between text-left"
                      >
                        <span className="text-xs text-white/40 flex items-center gap-2">
                          <span className="text-sm">🤖</span>
                          AI自律実行中の指令 ({aiDirectives.length}件)
                          <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded">07:30に自動処理</span>
                        </span>
                        <span className="text-white/30 text-xs">{showAiDirectives ? "▲ 閉じる" : "▼ 見る"}</span>
                      </button>
                      {showAiDirectives && (
                        <div className="mt-2.5 space-y-1.5 border-t border-white/5 pt-2.5">
                          {aiDirectives.map((d) => (
                            <div key={d.id} className="flex items-start gap-2 text-[11px] text-white/40">
                              <span>{priIcon[d.priority]}</span>
                              <span className="line-clamp-2">{d.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}

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
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold text-amber-400/70 uppercase tracking-wider">投稿スケジュール【回復モード】</h2>
                  <span className="text-[10px] text-amber-400/60">⚠️ 2本/日</span>
                </div>
                <div className="space-y-1">
                  {schedule.map((s) => (
                    <div key={`${s.time}-${s.type}`} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
                      <span className="text-xs font-mono text-indigo-300">{s.time}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${typeBadge(s.type)}`}>
                        {s.label}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-white/20 mt-2">💬 = リンクなし・共感型 / 🎭 = アフィリリンク付き</p>
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
        {/* ════════════════════ 回復研究タブ ════════════════════ */}
        {tab === "research" && (() => {
          const snapshots = snapshotsData?.snapshots ?? [];
          const observations = obsData?.observations ?? [];
          const catLabel: Record<string, string> = {
            engagement: "💬 エンゲージメント研究",
            product: "🎬 良作品研究",
            "safe-post": "🛡 安全投稿研究",
            other: "📝 その他",
          };
          const prioStyle: Record<string, string> = {
            high: "bg-rose-500/20 text-rose-300 border-rose-500/30",
            medium: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
            low: "bg-white/10 text-white/40 border-white/20",
          };

          async function captureSnapshot() {
            const r = await fetch(`${API}/api/bot/snapshots/capture`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: "手動記録" }) });
            if (r.ok) refetchSnapshots();
          }
          async function submitObservation(e: React.FormEvent) {
            e.preventDefault();
            if (!obsForm.observation.trim()) return;
            setObsSubmitting(true);
            try {
              const r = await fetch(`${API}/api/bot/observations`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(obsForm),
              });
              if (r.ok) {
                setObsForm({ category: "engagement", observation: "", source: "", hypothesis: "", priority: "medium" });
                refetchObs();
              }
            } finally {
              setObsSubmitting(false);
            }
          }
          async function deleteObs(id: string) {
            await fetch(`${API}/api/bot/observations/${id}`, { method: "DELETE" });
            refetchObs();
          }

          // フォロワー推移チャートデータ
          const snapChartData = snapshots.slice(-12).map((s) => ({
            date: new Date(s.recordedAt).toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" }),
            followers: s.followersCount,
          }));
          const latestSnap = snapshots.at(-1);
          const firstSnap = snapshots.at(0);
          const followerDelta = (latestSnap && firstSnap && latestSnap !== firstSnap)
            ? latestSnap.followersCount - firstSnap.followersCount
            : null;

          return (
            <>
              {/* 回復モードバナー */}
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">⚠️</span>
                  <div>
                    <h2 className="text-sm font-bold text-amber-300 mb-1">シャドウバン回復モード</h2>
                    <p className="text-xs text-amber-200/70">
                      1日2件体制で信頼スコア回復中。この期間を活用して「回復後の政策」を研究・蓄積します。
                    </p>
                    <div className="mt-2 flex gap-4 text-xs text-amber-200/60">
                      <span>📅 Phase 1: 手動観察 + 2件/日 (〜4週間)</span>
                      <span>📈 目標: インプ 10以上で回復確認</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* フォロワー数推移 */}
              <div className="rounded-xl border border-white/8 bg-white/5 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider">フォロワー数推移（週次）</h2>
                  <button
                    onClick={captureSnapshot}
                    className="text-[11px] px-3 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition-colors"
                  >
                    今すぐ記録
                  </button>
                </div>
                {latestSnap ? (
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <StatCard label="現在のフォロワー" value={latestSnap.followersCount.toLocaleString()} accent="text-emerald-400" />
                    <StatCard label="フォロー中" value={latestSnap.followingCount.toLocaleString()} />
                    <StatCard
                      label="総ツイート数"
                      value={latestSnap.tweetCount.toLocaleString()}
                      sub={followerDelta !== null ? `追跡開始から ${followerDelta >= 0 ? "+" : ""}${followerDelta}人` : undefined}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-white/30 text-center py-4 mb-4">「今すぐ記録」でスナップショットを取得してください</p>
                )}
                {snapChartData.length >= 2 && (
                  <ResponsiveContainer width="100%" height={120}>
                    <LineChart data={snapChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }} />
                      <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }} domain={["dataMin - 5", "dataMax + 5"]} />
                      <RechartTooltip
                        contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                        formatter={(v: number) => [v, "フォロワー"]}
                      />
                      <Line type="monotone" dataKey="followers" stroke="#34d399" strokeWidth={2} dot={{ r: 3, fill: "#34d399" }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
                {snapshots.length > 0 && (
                  <div className="mt-3 space-y-1 max-h-32 overflow-y-auto">
                    {[...snapshots].reverse().slice(0, 10).map((s, i) => (
                      <div key={i} className="flex items-center justify-between text-[10px] text-white/40 px-1">
                        <span>{fmtDate(s.recordedAt)}</span>
                        <span className="text-emerald-400">👥 {s.followersCount}</span>
                        {s.note && <span className="text-white/25">{s.note}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 研究ログ入力フォーム */}
              <div className="rounded-xl border border-white/8 bg-white/5 p-4">
                <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">観察ログを追加</h2>
                <form onSubmit={submitObservation} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-white/40 block mb-1">カテゴリー</label>
                      <select
                        value={obsForm.category}
                        onChange={(e) => setObsForm((f) => ({ ...f, category: e.target.value }))}
                        className="w-full text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white focus:outline-none focus:border-indigo-500/50"
                      >
                        <option value="engagement">💬 エンゲージメント研究</option>
                        <option value="product">🎬 良作品研究</option>
                        <option value="safe-post">🛡 安全投稿研究</option>
                        <option value="other">📝 その他</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-white/40 block mb-1">優先度</label>
                      <select
                        value={obsForm.priority}
                        onChange={(e) => setObsForm((f) => ({ ...f, priority: e.target.value }))}
                        className="w-full text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white focus:outline-none focus:border-indigo-500/50"
                      >
                        <option value="high">🔴 高（必ず採用を検討）</option>
                        <option value="medium">🟡 中（参考情報）</option>
                        <option value="low">⚪ 低（メモ）</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-white/40 block mb-1">参照元 (任意: @アカウント名 or 作品名)</label>
                    <input
                      value={obsForm.source}
                      onChange={(e) => setObsForm((f) => ({ ...f, source: e.target.value }))}
                      placeholder="例: @xxx_adult, 君のことが好き"
                      className="w-full text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white placeholder-white/20 focus:outline-none focus:border-indigo-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-white/40 block mb-1">観察内容 *</label>
                    <textarea
                      value={obsForm.observation}
                      onChange={(e) => setObsForm((f) => ({ ...f, observation: e.target.value }))}
                      placeholder="例: 「〜系のつぶやきが500いいね取れた」「🔞マーク抜きの投稿の方がリーチが広い」など"
                      rows={3}
                      className="w-full text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white placeholder-white/20 focus:outline-none focus:border-indigo-500/50 resize-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-white/40 block mb-1">仮説 (任意: 「〜ではないか」)</label>
                    <input
                      value={obsForm.hypothesis}
                      onChange={(e) => setObsForm((f) => ({ ...f, hypothesis: e.target.value }))}
                      placeholder="例: 共感型ツイートはエロ系アカウントでもリーチしやすいのではないか"
                      className="w-full text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white placeholder-white/20 focus:outline-none focus:border-indigo-500/50"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={obsSubmitting || !obsForm.observation.trim()}
                    className="w-full py-2 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-medium hover:bg-indigo-500/30 transition-colors disabled:opacity-40"
                  >
                    {obsSubmitting ? "保存中..." : "観察を記録する"}
                  </button>
                </form>
              </div>

              {/* 観察ログ一覧 */}
              <div className="rounded-xl border border-white/8 bg-white/5 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider">蓄積観察ログ</h2>
                  <span className="text-[10px] text-white/30">{observations.length}件</span>
                </div>
                {observations.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-xs text-white/30">まだ観察ログがありません</p>
                    <p className="text-[10px] text-white/20 mt-1">Twitterを見て気づいたことを上のフォームから記録してください</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {["high", "medium", "low"].map((prio) => {
                      const group = observations.filter((o) => o.priority === prio);
                      if (group.length === 0) return null;
                      return (
                        <div key={prio}>
                          <p className="text-[10px] text-white/30 mb-1.5">{prio === "high" ? "🔴 高優先" : prio === "medium" ? "🟡 中優先" : "⚪ 低優先"}</p>
                          {group.map((obs) => (
                            <div key={obs.id} className="p-3 rounded-lg bg-white/5 border border-white/8 mb-2">
                              <div className="flex items-start justify-between gap-2 mb-1.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${prioStyle[obs.priority]}`}>
                                    {catLabel[obs.category] ?? obs.category}
                                  </span>
                                  {obs.source && (
                                    <span className="text-[10px] text-blue-400">{obs.source}</span>
                                  )}
                                  <span className="text-[10px] text-white/25">{fmtDate(obs.recordedAt)}</span>
                                </div>
                                <button
                                  onClick={() => deleteObs(obs.id)}
                                  className="text-[10px] text-white/20 hover:text-red-400 transition-colors shrink-0"
                                >
                                  ✕
                                </button>
                              </div>
                              <p className="text-xs text-white/70">{obs.observation}</p>
                              {obs.hypothesis && (
                                <p className="text-[10px] text-indigo-300 mt-1">→ 仮説: {obs.hypothesis}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 戦略エンジンの回復期仮説 */}
              {strategy && (() => {
                const researchHyps = strategy.hypotheses.filter((h) => h.id.startsWith("research-"));
                if (researchHyps.length === 0) return null;
                return (
                  <div className="rounded-xl border border-white/8 bg-white/5 p-4">
                    <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">回復後の政策仮説（自動追跡）</h2>
                    <div className="space-y-2">
                      {researchHyps.map((h) => <HypothesisCard key={h.id} h={h} />)}
                    </div>
                  </div>
                );
              })()}
            </>
          );
        })()}

        {/* ════════════════════ タスク管理タブ ════════════════════ */}
        {tab === "tasks" && (
          <div className="space-y-6 py-4">
            {/* ヘッダー */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white">✅ タスク管理</h2>
                <p className="text-[11px] text-white/35 mt-0.5">
                  ロードマップから生成されたデイリー・ウィークリータスク
                </p>
              </div>
              {tasks && (
                <div className="text-right text-[10px] text-white/30">
                  <p>📅 {tasks.dateKey}</p>
                  <p>📆 {tasks.weekKey}</p>
                </div>
              )}
            </div>

            {tasksLoading && !tasks && (
              <div className="text-center py-12">
                <p className="text-xs text-white/30 animate-pulse">タスクを読み込み中...</p>
              </div>
            )}

            {tasks && (() => {
              // タスクカード1件
              function TaskCard({ item }: { item: TaskItem }) {
                const isAI = item.assignee === "ai";
                const toggling = taskToggling.has(item.completionKey);
                return (
                  <div
                    className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${
                      item.completed
                        ? "border-white/6 bg-white/3 opacity-60"
                        : isAI
                          ? "border-blue-500/20 bg-blue-500/5 hover:border-blue-400/30"
                          : "border-white/10 bg-white/5 hover:border-indigo-400/30 hover:bg-white/8 cursor-pointer"
                    }`}
                    onClick={() => !isAI && toggleTaskItem(item)}
                  >
                    {/* チェックボックス */}
                    <div className="shrink-0 mt-0.5">
                      {isAI ? (
                        <div className={`w-5 h-5 rounded flex items-center justify-center border text-[10px] ${
                          item.completed
                            ? "bg-blue-500/30 border-blue-400/40 text-blue-300"
                            : "bg-blue-500/10 border-blue-400/20 text-blue-400/40"
                        }`}>
                          {item.completed ? "✓" : "⟳"}
                        </div>
                      ) : (
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                          toggling
                            ? "border-white/20 bg-white/5"
                            : item.completed
                              ? "bg-emerald-500 border-emerald-400 text-white"
                              : "border-white/30 hover:border-indigo-400"
                        }`}>
                          {item.completed && <span className="text-[11px] font-bold">✓</span>}
                          {toggling && <span className="text-[9px] text-white/30 animate-pulse">⟳</span>}
                        </div>
                      )}
                    </div>

                    {/* テキスト */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm">{item.emoji}</span>
                        <p className={`text-[12px] font-medium leading-snug ${item.completed ? "line-through text-white/40" : "text-white/90"}`}>
                          {item.title}
                        </p>
                        {isAI && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/15 border border-blue-400/20 text-blue-300 shrink-0">自動</span>
                        )}
                        {item.isDirective && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-400/20 text-indigo-300 shrink-0">会議決定</span>
                        )}
                      </div>
                      <p className="text-[10px] text-white/30 mt-0.5 leading-relaxed">{item.description}</p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {item.scheduledTime && (
                          <span className="text-[9px] text-blue-400/70 flex items-center gap-0.5">
                            🕐 {item.scheduledTime}
                          </span>
                        )}
                        {item.scheduledDay && (
                          <span className="text-[9px] text-amber-400/70 flex items-center gap-0.5">
                            📅 {item.scheduledDay}
                          </span>
                        )}
                        {item.completed && item.completedAt && (
                          <span className="text-[9px] text-white/25">
                            {item.completedBy === "bot" ? "🤖 自動完了" : "👤 完了"}
                            {" "}{fmtDate(item.completedAt).slice(5, 16)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              const dailyDone = tasks.daily.filter((t) => t.completed).length;
              const weeklyDone = tasks.weekly.filter((t) => t.completed).length;

              return (
                <div className="space-y-6">
                  {/* ── デイリータスク ── */}
                  <section>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          📅 今日のタスク
                          <span className="text-[10px] font-normal text-white/35">{tasks.dateKey}</span>
                        </h3>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          {tasks.daily.map((_, i) => (
                            <div key={i} className={`h-1.5 w-6 rounded-full ${i < dailyDone ? "bg-emerald-400" : "bg-white/10"}`} />
                          ))}
                        </div>
                        <span className="text-[11px] text-white/40">{dailyDone}/{tasks.daily.length}</span>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      {/* 手動タスク（上段） */}
                      <div>
                        <p className="text-[10px] text-white/30 mb-1.5 flex items-center gap-1">👤 あなたがやること</p>
                        <div className="space-y-2">
                          {tasks.daily.filter((t) => t.assignee === "user").map((item) => (
                            <TaskCard key={item.id} item={item} />
                          ))}
                        </div>
                      </div>
                      {/* 自動タスク（下段） */}
                      <div className="mt-2">
                        <p className="text-[10px] text-white/30 mb-1.5 flex items-center gap-1">🤖 AIが自動でやること</p>
                        <div className="space-y-2">
                          {tasks.daily.filter((t) => t.assignee === "ai").map((item) => (
                            <TaskCard key={item.id} item={item} />
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* ── ウィークリータスク ── */}
                  <section>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          📆 今週のタスク
                          <span className="text-[10px] font-normal text-white/35">{tasks.weekKey}</span>
                        </h3>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          {tasks.weekly.map((_, i) => (
                            <div key={i} className={`h-1.5 w-5 rounded-full ${i < weeklyDone ? "bg-emerald-400" : "bg-white/10"}`} />
                          ))}
                        </div>
                        <span className="text-[11px] text-white/40">{weeklyDone}/{tasks.weekly.length}</span>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <div>
                        <p className="text-[10px] text-white/30 mb-1.5 flex items-center gap-1">👤 あなたがやること</p>
                        <div className="space-y-2">
                          {tasks.weekly.filter((t) => t.assignee === "user").map((item) => (
                            <TaskCard key={item.id} item={item} />
                          ))}
                        </div>
                      </div>
                      <div className="mt-2">
                        <p className="text-[10px] text-white/30 mb-1.5 flex items-center gap-1">🤖 AIが自動でやること</p>
                        <div className="space-y-2">
                          {tasks.weekly.filter((t) => t.assignee === "ai").map((item) => (
                            <TaskCard key={item.id} item={item} />
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* 説明フッター */}
                  <div className="bg-white/3 border border-white/8 rounded-xl p-4">
                    <p className="text-[10px] text-white/30 leading-relaxed">
                      <span className="text-white/50 font-medium">タスクのルール：</span><br/>
                      👤 手動タスク — あなたがチェックを入れてください。毎日/毎週リセットされます。<br/>
                      🤖 自動タスク — ボットが実行した時点で自動的にチェックが入ります。手動変更不可。<br/>
                      📌 会議決定タスク — 会議室で採用したディレクティブが自動追加されます。
                    </p>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ════════════════════ 機能一覧タブ ════════════════════ */}
        {tab === "features" && (() => {
          const weights = strategy?.typeWeights ?? {};
          const templates = strategy?.dynamicTemplates;
          const hypotheses = strategy?.hypotheses ?? [];
          const directives = activeDirectives;

          type FeatureItem = { name: string; desc: string; value?: string; status: "active" | "passive" | "manual" };
          type FeatureGroup = { title: string; emoji: string; color: string; features: FeatureItem[] };

          const FEATURE_GROUPS: FeatureGroup[] = [
            {
              title: "投稿スケジューラー", emoji: "📅", color: "indigo",
              features: [
                { name: "A/Bテストモード", desc: "週単位でスロットを切り替えて効果測定", value: "有効（1日1件）", status: "active" },
                { name: "W1スロット", desc: "4/7〜4/13: 毎朝10:30 JST に芸能人アフィリ投稿", value: "10:30 JST", status: "active" },
                { name: "W2スロット", desc: "4/14〜4/20: 毎朝05:00 JST に芸能人アフィリ投稿", value: "05:00 JST", status: "active" },
                { name: "通常週スロット", desc: "W3以降: 18〜22時の動的スロット（最良時間帯を自動選択）", value: "18-22 JST 動的", status: "active" },
                { name: "追い投稿（catch-up）", desc: "サーバー再起動後に当日スロットを見逃していれば即補完", status: "active" },
                { name: "週次キャンペーンID探索", desc: "毎週日曜 03:00 JST に新しい商品IDを自動探索", status: "active" },
              ],
            },
            {
              title: "コンテンツ生成", emoji: "✍️", color: "pink",
              features: [
                { name: "芸能人アフィリツイート", desc: "芸能人名マッピング×フック5種×FANZA商品を組み合わせて生成", status: "active" },
                { name: "フック5種ローテーション", desc: "「正直に言う」「知らないと損」「これだけは見てほしい」「頭から離れない」「証明してる」", status: "active" },
                { name: "5型コンテンツ分類", desc: "レビュー/比較/ランキング/失敗回避/共感の型でテンプレを自動選択", status: "active" },
                { name: "動的テンプレート", desc: `${templates?.count ?? "—"}件管理 / 進化回数 ${templates?.evolutionCount ?? "—"}回`, value: `${templates?.count ?? "?"}件`, status: "active" },
                { name: "🔞マーク必須バリデーション", desc: "🔞なし・ハッシュタグあり・{{URL}}なしは投稿ブロック", status: "active" },
                { name: "80〜110字制限", desc: "文字数が範囲外の場合はテンプレ再生成", status: "active" },
              ],
            },
            {
              title: "戦略エンジン", emoji: "🧠", color: "violet",
              features: [
                { name: "コンテンツ重み制御", desc: `buzz:${weights.buzz ?? "?"} / rank:${weights.rank ?? "?"} / amateur:${weights.amateur ?? "?"} / sale:${weights.sale ?? "?"} / random:${weights.random ?? "?"}`, value: `${Object.keys(weights).length}種別`, status: "active" },
                { name: "仮説検証ループ", desc: `${hypotheses.length}件の仮説を継続検証中`, value: `${hypotheses.filter(h=>h.status==="confirmed").length}件確認済`, status: "active" },
                { name: "外部パターン分析", desc: "他アカウントの高エンゲージメントツイートを100件収集・パターン抽出", status: "active" },
                { name: "テンプレート自動進化", desc: "低スコアテンプレを廃棄し、外部パターンから新テンプレを生成", status: "active" },
                { name: "日次戦略評価", desc: "毎日 03:00 JST にパターン分析・仮説更新・重み調整を自動実行", status: "active" },
                { name: "週次レポート", desc: "毎週月曜 08:00 JST にアカウントスナップショットとパフォーマンスレポートを記録", status: "active" },
              ],
            },
            {
              title: "3者会議室", emoji: "🤝", color: "emerald",
              features: [
                { name: "リサーチモード (o3)", desc: "o3が市場調査・シャドウバン分析・戦略立案を深堀りリサーチ", status: "active" },
                { name: "ディベートモード", desc: "o3 Thinkingと Claude Sonnetが同一議題でそれぞれ独立回答", status: "active" },
                { name: "3者同時討論 (Trialogue)", desc: "o3 → Claude → Grok の順で互いの回答を参照して討論（5ラウンド）", status: "active" },
                { name: "Q&Aセッション", desc: "討論後に2ラウンドの追加Q&A（AIが答える）", status: "active" },
                { name: "決定事項自動抽出", desc: "会議ログからClaude Sonnetが実行可能なDirectiveを自動抽出", status: "active" },
                { name: "ディレクティブ自動実行", desc: `${directives.length}件のアクティブ決定事項 / AIアサイン分はワンクリック実行`, value: `${directives.length}件`, status: "active" },
              ],
            },
            {
              title: "監視・回復", emoji: "🔍", color: "amber",
              features: [
                { name: "シャドウバン自動チェック", desc: "毎日 23:00 JST に shadowban.eu API で状態確認", status: "active" },
                { name: "ウォッチドッグ", desc: "投稿失敗・API異常を検知し自動リカバリ試行", status: "active" },
                { name: "指標自動更新", desc: "投稿後に Twitter API でインプ・いいね・RTを自動取得", status: "active" },
                { name: "外部パターン監視", desc: "1時間ごとに競合アカウントの高スコアツイートを自動収集", status: "active" },
              ],
            },
            {
              title: "データ永続化", emoji: "☁️", color: "sky",
              features: [
                { name: "GCS永続化", desc: "全データ（投稿・テンプレ・会議・戦略）をGoogle Cloud Storageに自動保存", status: "active" },
                { name: "アカウントスナップショット", desc: "フォロワー数・ツイート数を週次で記録・推移追跡", status: "active" },
                { name: "手動観察ログ", desc: "ユーザーが気づいたことをエンゲージメント/商品/safe-post等に分類して記録", status: "active" },
              ],
            },
            {
              title: "クイック設定", emoji: "⚙️", color: "rose",
              features: [
                { name: "自然言語設定変更", desc: "テキスト入力でClaude Sonnetが即時解釈・設定変更を実行（会議室不要）", status: "active" },
                { name: "プリセット操作", desc: "buzzの重みを上げる・テンプレ追加などよく使う操作をワンタップで入力", status: "active" },
              ],
            },
            {
              title: "手動タスク（ユーザー担当）", emoji: "👤", color: "gray",
              features: [
                { name: "Rebrandly URL短縮・計測", desc: "アフィリリンクをRebrandlyで短縮し、クリック数を計測", status: "manual" },
                { name: "Googleスプレッドシート記録", desc: "日付/投稿タイプ/IMP/CTRを毎日手動記録", status: "manual" },
                { name: "shadowban.eu週次チェック", desc: "毎週月曜に手動でSBステータスを確認", status: "manual" },
                { name: "サブアカウント育成", desc: "4/21以降: サブ垢3体の作成・ウォームアップ・本垢へのいいね", status: "manual" },
              ],
            },
          ];

          const colorMap: Record<string, { badge: string; header: string; icon: string }> = {
            indigo: { badge: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300", header: "text-indigo-400", icon: "bg-indigo-500/20 text-indigo-300" },
            pink:   { badge: "border-pink-500/30 bg-pink-500/10 text-pink-300",       header: "text-pink-400",   icon: "bg-pink-500/20 text-pink-300" },
            violet: { badge: "border-violet-500/30 bg-violet-500/10 text-violet-300", header: "text-violet-400", icon: "bg-violet-500/20 text-violet-300" },
            emerald:{ badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", header: "text-emerald-400", icon: "bg-emerald-500/20 text-emerald-300" },
            amber:  { badge: "border-amber-500/30 bg-amber-500/10 text-amber-300",    header: "text-amber-400",  icon: "bg-amber-500/20 text-amber-300" },
            sky:    { badge: "border-sky-500/30 bg-sky-500/10 text-sky-300",          header: "text-sky-400",    icon: "bg-sky-500/20 text-sky-300" },
            rose:   { badge: "border-rose-500/30 bg-rose-500/10 text-rose-300",       header: "text-rose-400",   icon: "bg-rose-500/20 text-rose-300" },
            gray:   { badge: "border-white/10 bg-white/5 text-white/40",              header: "text-white/50",   icon: "bg-white/10 text-white/40" },
          };

          const totalActive = FEATURE_GROUPS.flatMap(g => g.features).filter(f => f.status === "active").length;
          const totalManual = FEATURE_GROUPS.flatMap(g => g.features).filter(f => f.status === "manual").length;

          return (
            <div className="space-y-4">
              {/* サマリーヘッダー */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-wrap gap-4 items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-white">FANZA X Bot — 全機能一覧</h2>
                  <p className="text-xs text-white/40 mt-0.5">現在稼働中の全機能と手動タスクの一覧</p>
                </div>
                <div className="flex gap-3">
                  <div className="text-center">
                    <p className="text-xl font-bold text-emerald-400">{totalActive}</p>
                    <p className="text-[10px] text-white/40">自動稼働中</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-amber-400">{totalManual}</p>
                    <p className="text-[10px] text-white/40">手動タスク</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-indigo-400">{FEATURE_GROUPS.length}</p>
                    <p className="text-[10px] text-white/40">カテゴリ</p>
                  </div>
                </div>
              </div>

              {/* 機能グループ */}
              {FEATURE_GROUPS.map((group) => {
                const c = colorMap[group.color];
                return (
                  <div key={group.title} className="rounded-xl border border-white/8 bg-white/5 overflow-hidden">
                    {/* グループヘッダー */}
                    <div className="px-4 py-2.5 border-b border-white/8 flex items-center gap-2">
                      <span className="text-base">{group.emoji}</span>
                      <h3 className={`text-xs font-semibold uppercase tracking-wider ${c.header}`}>{group.title}</h3>
                      <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded border ${c.badge}`}>
                        {group.features.length}件
                      </span>
                    </div>

                    {/* 機能リスト */}
                    <div className="divide-y divide-white/5">
                      {group.features.map((feat) => (
                        <div key={feat.name} className="px-4 py-2.5 flex items-start gap-3">
                          {/* ステータスドット */}
                          <div className="mt-0.5 shrink-0">
                            {feat.status === "active"  && <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" /></span>}
                            {feat.status === "passive" && <span className="inline-flex rounded-full h-2 w-2 bg-white/20" />}
                            {feat.status === "manual"  && <span className="inline-flex rounded-full h-2 w-2 bg-amber-500/60" />}
                          </div>

                          {/* 説明 */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium text-white/85">{feat.name}</span>
                              {feat.value && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${c.badge}`}>
                                  {feat.value}
                                </span>
                              )}
                              {feat.status === "manual" && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 shrink-0">手動</span>
                              )}
                            </div>
                            <p className="text-[11px] text-white/40 mt-0.5 leading-relaxed">{feat.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* 凡例 */}
              <div className="flex items-center gap-4 text-[11px] text-white/40 px-1">
                <span className="flex items-center gap-1.5"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" /></span> 自動稼働中</span>
                <span className="flex items-center gap-1.5"><span className="inline-flex rounded-full h-2 w-2 bg-amber-500/60" /> 手動タスク</span>
              </div>
            </div>
          );
        })()}

        {/* ════════════════════ 目標タブ ════════════════════ */}
        {tab === "goals" && (
          <div className="space-y-5">
            {/* 収益目標バナー */}
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-xs text-amber-300/70 mb-0.5">3ヶ月収益目標</p>
                  <div className="flex items-baseline gap-3">
                    <span className="text-2xl font-bold text-amber-300">
                      ¥{goalsData?.goal.stretch.toLocaleString() ?? "50,000"}
                    </span>
                    <span className="text-xs text-amber-300/50">
                      ベース目標 ¥{goalsData?.goal.base.toLocaleString() ?? "30,000"}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-amber-300/50">開始日</p>
                  <p className="text-sm font-medium text-amber-300">{goalsData?.goal.startDate ?? "2026-04-06"}</p>
                </div>
              </div>
            </div>

            {/* Gate 達成状況 */}
            <div>
              <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">Gate 達成条件</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(goalsData?.gates ?? []).map((gate) => {
                  const statusCfg = {
                    upcoming: { border: "border-white/10", bg: "bg-white/5",          badge: "bg-white/10 text-white/40",          label: "予定" },
                    today:    { border: "border-amber-500/40", bg: "bg-amber-500/10", badge: "bg-amber-500/20 text-amber-300",      label: "本日判定" },
                    past:     { border: "border-white/10", bg: "bg-white/5",          badge: "bg-white/10 text-white/40",          label: "判定済" },
                  }[gate.status];
                  const allPassed = gate.conditions.every(c => c.achieved === true);
                  const anyFailed = gate.conditions.some(c => c.achieved === false);
                  const gateResult = gate.status === "past" || gate.status === "today"
                    ? (allPassed ? { icon: "✅", cls: "text-emerald-400" } : anyFailed ? { icon: "❌", cls: "text-red-400" } : { icon: "⏳", cls: "text-white/40" })
                    : null;
                  return (
                    <div key={gate.id} className={`rounded-xl border p-3 ${statusCfg.border} ${statusCfg.bg}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-white">{gate.id}</span>
                          {gateResult && <span className={`text-sm ${gateResult.cls}`}>{gateResult.icon}</span>}
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusCfg.badge}`}>{statusCfg.label}</span>
                      </div>
                      <p className="text-xs text-white/60 mb-1">{gate.label}</p>
                      <p className="text-[10px] text-white/30 mb-2">{gate.date}</p>
                      <div className="space-y-1">
                        {gate.conditions.map((c) => (
                          <div key={c.metric} className="flex items-center justify-between text-[11px]">
                            <span className="text-white/50">{c.label}</span>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-white/70">≥ {c.target}{c.unit}</span>
                              {c.actual !== null && (
                                <span className={`font-mono font-medium ${c.achieved ? "text-emerald-400" : "text-red-400"}`}>
                                  ({c.actual}{c.unit})
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 週次KPI一覧 */}
            <div>
              <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">週次KPIロードマップ</h3>
              <div className="space-y-2">
                {(goalsData?.weeks ?? []).map((w) => {
                  const cfg = {
                    current:  { border: "border-indigo-500/40", bg: "bg-indigo-500/10", badgeCls: "bg-indigo-500/20 text-indigo-300", badge: "今週" },
                    upcoming: { border: "border-white/10",      bg: "bg-white/5",       badgeCls: "bg-white/10 text-white/40",       badge: "予定" },
                    past:     { border: "border-white/10",      bg: "bg-white/5",       badgeCls: "bg-white/10 text-white/30",       badge: "完了" },
                  }[w.status];
                  return (
                    <div key={w.week} className={`rounded-xl border p-3 ${cfg.border} ${cfg.bg}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded shrink-0 ${cfg.badgeCls}`}>{w.week}</span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-white/60">{w.start.slice(5)} 〜 {w.end.slice(5)}</span>
                              <span className="text-[10px] text-white/30">{w.slot}</span>
                              {w.postCount > 0 && (
                                <span className="text-[10px] text-white/30">{w.postCount}投稿</span>
                              )}
                            </div>
                            {w.note && <p className="text-[10px] text-white/30 mt-0.5 truncate">{w.note}</p>}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${cfg.badgeCls}`}>{cfg.badge}</span>
                        </div>
                      </div>
                      {w.kpis.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {w.kpis.map((kpi) => {
                            const hasActual = kpi.actual !== null;
                            const achieved = kpi.achieved;
                            return (
                              <div key={kpi.metric} className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${
                                achieved === true  ? "border-emerald-500/30 bg-emerald-500/10" :
                                achieved === false ? "border-red-500/30 bg-red-500/10" :
                                "border-white/10 bg-white/5"
                              }`}>
                                <span className="text-white/50">{kpi.label}: </span>
                                <span className="font-medium text-white/80">
                                  {typeof kpi.target === "number" ? `≥ ${kpi.target}${kpi.unit}` : kpi.target}
                                </span>
                                {hasActual && (
                                  <span className={`ml-1.5 font-mono font-bold ${achieved ? "text-emerald-400" : "text-red-400"}`}>
                                    ({kpi.actual}{kpi.unit})
                                  </span>
                                )}
                                {!hasActual && w.status !== "upcoming" && (
                                  <span className="ml-1.5 text-white/20">（計測中）</span>
                                )}
                                {achieved === true && <span className="ml-1">✅</span>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* クイック設定への誘導 */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white/80">⚙️ 詳細設定を変更する</p>
                <p className="text-xs text-white/40 mt-0.5">投稿重み・間隔・テンプレートなどをAIに自然言語で指示</p>
              </div>
              <button
                onClick={() => { setQcOpen(true); setQcResult(null); setQcInput(""); }}
                className="shrink-0 px-4 py-2 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-medium hover:bg-indigo-500/30 transition-colors"
              >
                クイック設定を開く
              </button>
            </div>
          </div>
        )}

        {/* ════════════════════ 3者会議室タブ ════════════════════ */}
        {tab === "meeting" && (() => {
          const PRESET_TOPICS = [
            // ── Threads 方針決定（新規追加） ──────────────────────────────────
            "【🪡 Threads 方針決定】Threadsで芸能人・エンタメ系コンテンツを発信しAmazon/楽天アフィリエイトで収益化するアカウントの最適な運営方針を決定する。調査すべき観点：①Threadsで成功している日本語アフィリエイトアカウントの特徴、②芸能人コンテンツの中で最もエンゲージメントが高いジャンル（グラビア・アイドル・俳優・女優）、③投稿トーン（個人感あり vs まとめ系）の成功率、④1日の投稿頻度と最適時間帯、⑤アカウントキャラクター設定の有無による差。これらを踏まえてGPT・Claude・Grokが3者で議論し、具体的な運営方針を決定すること。",
            "【🪡 Threadsアカウント収益化】Threads × Amazon/楽天アフィリエイトで月5万円以上稼いでいるアカウントの実例を調査。成功しているアカウントが扱う商品カテゴリ（写真集・DVD・Kindle・グッズ）、投稿フォーマット、フォロワー獲得速度、コンバージョン率の目安を教えてください。",
            "【🪡 Threadsアルゴリズム2025〜2026】Threadsの日本語アカウントにおけるアルゴリズムの特徴を調査してください。フォロワー外へのリーチ条件、おすすめ表示に乗りやすい投稿の特徴、エンゲージメント（いいね・返信・リポスト）の重み付け、投稿頻度の最適値を教えてください。",
            // ── X 既存トピック ─────────────────────────────────────────────────
            "Xのシャドウバン（Ghost Ban）から回復した日本語アカウントの実例と、回復を加速させた投稿戦略を調査してください。成人向けコンテンツアカウントの事例、回復にかかった平均日数、インプレッション数の変化を教えてください。",
            "FANZAアフィリエイトで月10万円以上稼いでいるXアカウントの投稿パターン・頻度・コンテンツ内容を調査してください。成功事例に共通する戦略を教えてください。",
            "X（Twitter）の2025〜2026年における成人向けコンテンツへのアルゴリズム変化を調査してください。インプレッション・リーチへの影響と対策を教えてください。",
            "いいね・RTを多く獲得できる「インプ狙いツイート」の最適な文体・構成・絵文字の使い方を調査してください。非宣伝ツイートでバズる法則を教えてください。",
          ];

          const catOptions: { value: MeetingDirective["category"]; label: string }[] = [
            { value: "strategy", label: "🧠 戦略" },
            { value: "content",  label: "📝 コンテンツ" },
            { value: "timing",   label: "⏰ タイミング" },
            { value: "recovery", label: "🔄 回復" },
            { value: "other",    label: "📌 その他" },
          ];
          const priOptions: { value: MeetingDirective["priority"]; label: string; color: string }[] = [
            { value: "high",   label: "🔴 高", color: "text-red-300" },
            { value: "medium", label: "🟡 中", color: "text-yellow-300" },
            { value: "low",    label: "🟢 低", color: "text-emerald-300" },
          ];
          const catColor: Record<string, string> = {
            strategy: "text-violet-300 border-violet-500/30 bg-violet-500/10",
            content:  "text-blue-300 border-blue-500/30 bg-blue-500/10",
            timing:   "text-amber-300 border-amber-500/30 bg-amber-500/10",
            recovery: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
            other:    "text-white/50 border-white/10 bg-white/5",
          };
          const priIcon: Record<string, string> = { high: "🔴", medium: "🟡", low: "🟢" };

          async function startResearch(topic: string) {
            if (!topic.trim()) return;
            setResearchLoading(true);
            setResearchError(null);
            setResearchResult(null);
            setMeetingSession(null);
            setCandidates([]);
            try {
              const res = await fetch(`${API}/api/bot/meeting/research`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ topic }),
              });
              let data: any;
              try { data = await res.json(); } catch { data = {}; }
              if (!res.ok) {
                const msg = data?.error ?? `リサーチAPIエラー (HTTP ${res.status})`;
                // 429クォータエラーをわかりやすく表示
                if (res.status === 429 || (typeof msg === "string" && msg.includes("429"))) {
                  throw new Error("AIのクォータ制限に達しました。しばらく待ってから再試行してください。");
                }
                throw new Error(msg);
              }
              setResearchResult(data);
            } catch (e: any) {
              const msg = e?.message ?? String(e);
              // iOS Safariの「The string did not match the expected pattern.」など汎用エラーを日本語化
              if (msg.includes("string did not match") || msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
                setResearchError("ネットワークエラーが発生しました。通信状況を確認して再試行してください。");
              } else {
                setResearchError(msg);
              }
            } finally {
              setResearchLoading(false);
            }
          }

          async function startMeeting() {
            if (!researchResult) return;
            setMeetingCreating(true);
            setCandidates([]);
            setDebateCompleted(false);
            setQaRoundsLeft(2);
            try {
              const res = await fetch(`${API}/api/bot/meeting/sessions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: researchResult.topic.slice(0, 40), researchId: researchResult.id }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error ?? "エラー");
              setMeetingSession(data);
            } catch (e: any) {
              alert("会議作成エラー: " + e.message);
            } finally {
              setMeetingCreating(false);
            }
          }

          // 送信モードに応じて送信先を切り替え
          async function sendMessage() {
            if (!meetingSession || !meetingInput.trim()) return;
            const msg = meetingInput.trim();
            setMeetingInput("");
            setMeetingLoading(true);
            // 楽観的にユーザー発言を表示
            const userMsg: MeetingMessage = { role: "user", speaker: "user", content: msg, at: new Date().toISOString() };
            setMeetingSession((s) => s ? { ...s, messages: [...s.messages, userMsg] } : s);

            try {
              if (sendMode === "trialogue") {
                // スコアをリセット
                setCumulativeScores({ gpt: 0, claude: 0 });
                setGrokVerdict(null);
                // 1ラウンドずつ5回呼び出し（タイムアウト回避）
                const ROUNDS = 5;
                let lastGptReply = "", lastClaudeReply = "", lastGrokReply = "";
                let cumul = { gpt: 0, claude: 0 };
                for (let round = 1; round <= ROUNDS; round++) {
                  setTrialoguRound(round);  // ← 進捗インジケーター更新
                  const res = await fetch(`${API}/api/bot/meeting/sessions/${meetingSession.id}/trialogue`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ message: msg, round, lastGptReply, lastClaudeReply, lastGrokReply, cumulativeScores: cumul }),
                  });
                  let data: any;
                  try { data = await res.json(); } catch { data = {}; }
                  if (!res.ok) {
                    const rawMsg = data?.error ?? `ラウンド${round}エラー (HTTP ${res.status})`;
                    if (res.status === 429 || (typeof rawMsg === "string" && rawMsg.includes("429"))) {
                      throw new Error(`🚦 AIクォータ制限（ラウンド${round}）。数分後に再試行してください。`);
                    }
                    throw new Error(rawMsg);
                  }
                  // ラウンドの発言を即時表示
                  setMeetingSession((s) => s ? {
                    ...s,
                    messages: [...s.messages, ...(data.messages ?? [])],
                  } : s);
                  // スコアを更新
                  if (data.cumulativeScores) {
                    cumul = data.cumulativeScores;
                    setCumulativeScores(cumul);
                  }
                  // 次ラウンドへ引き継ぐ最終発言
                  const msgs: MeetingMessage[] = data.messages ?? [];
                  const gpt = msgs.find((m: MeetingMessage) => m.speaker === "gpt");
                  const claude = msgs.find((m: MeetingMessage) => m.speaker === "claude");
                  const grok = msgs.find((m: MeetingMessage) => m.speaker === "grok");
                  if (gpt) lastGptReply = gpt.content;
                  if (claude) lastClaudeReply = claude.content;
                  if (grok) lastGrokReply = grok.content;
                  // 最終ラウンド: Grok裁定ディレクティブを記録
                  if (data.isLastRound && data.grokDirective) {
                    const winner = cumul.gpt >= cumul.claude ? "o3" : "Claude";
                    setGrokVerdict({ directive: data.grokDirective, winner });
                  }
                }
                // 5ラウンド完了 → Q&Aフェーズへ
                setDebateCompleted(true);
                setQaRoundsLeft(2);
              } else {
                // GPT のみ / Claude のみ
                const endpoint = sendMode === "gpt" ? "chat/gpt" : "chat/claude";
                const res = await fetch(`${API}/api/bot/meeting/sessions/${meetingSession.id}/${endpoint}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ message: msg }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error ?? "エラー");
                setMeetingSession((s) => s ? { ...s, messages: [...s.messages, data] } : s);
              }
            } catch (e: any) {
              const errMsg: MeetingMessage = { role: "assistant", speaker: "system", content: `❌ エラー: ${e.message}`, at: new Date().toISOString() };
              setMeetingSession((s) => s ? { ...s, messages: [...s.messages, errMsg] } : s);
            } finally {
              setMeetingLoading(false);
              setTrialoguRound(0);
            }
          }

          // 決定事項を自動抽出（Claudeが議事録を解析）
          async function extractDecisionsFromSession() {
            if (!meetingSession) return;
            setExtractLoading(true);
            try {
              const res = await fetch(`${API}/api/bot/meeting/sessions/${meetingSession.id}/extract-decisions`, {
                method: "POST",
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error ?? "エラー");
              setCandidates(data.candidates ?? []);
            } catch (e: any) {
              alert("抽出エラー: " + e.message);
            } finally {
              setExtractLoading(false);
            }
          }

          // 候補を1クリックで決定事項として保存
          async function adoptCandidate(c: DecisionCandidate) {
            try {
              await fetch(`${API}/api/bot/meeting/directives`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  text: c.text,
                  category: c.category,
                  priority: c.priority,
                  assignee: c.assignee ?? "user",
                  source: meetingSession ? `会議: ${meetingSession.title}` : "会議室",
                  platform,  // 現在のプラットフォーム（x or threads）を付与
                }),
              });
              await refetchDirectives();
              setCandidates((prev) => prev.filter((x) => x.id !== c.id));
            } catch (e: any) {
              alert("保存エラー: " + e.message);
            }
          }

          // Q&Aラウンド送信（両者が回答）
          async function sendQAMessage() {
            if (!meetingSession || !qaInput.trim() || qaRoundsLeft <= 0) return;
            const msg = qaInput.trim();
            setQaInput("");
            setQaLoading(true);
            const userMsg: MeetingMessage = { role: "user", speaker: "user", content: msg, at: new Date().toISOString() };
            setMeetingSession((s) => s ? { ...s, messages: [...s.messages, userMsg] } : s);
            try {
              const res = await fetch(`${API}/api/bot/meeting/sessions/${meetingSession.id}/qa`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: msg }),
              });
              let data: any;
              try { data = await res.json(); } catch { data = {}; }
              if (!res.ok) {
                const rawMsg = data?.error ?? `Q&Aエラー (HTTP ${res.status})`;
                if (res.status === 429 || (typeof rawMsg === "string" && rawMsg.includes("429"))) {
                  throw new Error("AIクォータ制限です。数分後に再試行してください。");
                }
                throw new Error(rawMsg);
              }
              // o3・Claude・Grokの回答をまとめて表示（undefinedはスキップ）
              const newMsgs = [data.gptMsg, data.claudeMsg, data.grokMsg].filter(Boolean);
              setMeetingSession((s) => s ? { ...s, messages: [...s.messages, ...newMsgs] } : s);
              setQaRoundsLeft((n) => n - 1);
            } catch (e: any) {
              const errMsg: MeetingMessage = { role: "assistant", speaker: "system", content: `❌ エラー: ${e.message}`, at: new Date().toISOString() };
              setMeetingSession((s) => s ? { ...s, messages: [...s.messages, errMsg] } : s);
            } finally {
              setQaLoading(false);
            }
          }

          async function saveDirective() {
            if (!dirModal) return;
            setDirSaving(true);
            // assignee をリセット後のため変数にキャプチャ
            const assignee = dirForm.assignee;
            try {
              const res = await fetch(`${API}/api/bot/meeting/directives`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: dirModal.text, category: dirForm.category, priority: dirForm.priority, assignee: assignee, source: dirModal.source, platform }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error ?? "エラー");
              await refetchDirectives();
              setDirModal(null);
            } catch (e: any) {
              alert("保存エラー: " + e.message);
            } finally {
              setDirSaving(false);
            }
          }

          async function updateStatus(id: string, status: MeetingDirective["status"]) {
            await fetch(`${API}/api/bot/meeting/directives/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status }),
            });
            await refetchDirectives();
          }

          async function runExecuteDirective(id: string) {
            setExecutingId(id);
            try {
              const r = await fetch(`${API}/api/bot/meeting/directives/${id}/execute`, { method: "POST" });
              const data = await r.json();
              if (!r.ok) throw new Error(data.error ?? "実行失敗");
              await refetchDirectives();
            } catch (e: any) {
              alert(`⚡ 自動実行エラー: ${e.message}`);
            } finally {
              setExecutingId(null);
            }
          }

          const allDirectives = directivesData?.directives ?? [];

          // スピーカーごとのスタイル定義
          const speakerStyle: Record<Speaker, { bg: string; border: string; text: string; label: string; icon: string }> = {
            user:   { bg: "bg-indigo-500/20",  border: "border-indigo-500/30",  text: "text-indigo-100",  label: "👤 あなた",              icon: "👤" },
            gpt:    { bg: "bg-blue-500/15",     border: "border-blue-500/30",    text: "text-blue-100",    label: "🤖 o3 Thinking",         icon: "🤖" },
            claude: { bg: "bg-violet-500/15",   border: "border-violet-500/30",  text: "text-violet-100",  label: "🧠 Claude Sonnet",       icon: "🧠" },
            grok:   { bg: "bg-orange-500/15",   border: "border-orange-500/30",  text: "text-orange-100",  label: "🦅 Grok (X情報官)",     icon: "🦅" },
            system: { bg: "bg-white/5",         border: "border-white/10",       text: "text-white/60",    label: "📋 システム",            icon: "📋" },
          };

          return (
            <>
              {/* Threads 方針決定バナー（Threadsプラットフォームのときのみ表示） */}
              {platform === "threads" && (
                <div className="rounded-xl border border-purple-500/30 bg-gradient-to-r from-purple-500/15 to-indigo-500/10 p-4 flex items-start gap-3">
                  <span className="text-2xl shrink-0">🪡</span>
                  <div>
                    <p className="text-sm font-bold text-purple-200 mb-1">Threads アカウント方針決定会議</p>
                    <p className="text-[11px] text-purple-200/60 leading-relaxed">
                      この会議でThreadsアカウントの運営方針を決定します。<br/>
                      下の <strong className="text-white">「プリセット」</strong> から
                      <span className="text-purple-300 font-semibold">「🪡 Threads 方針決定」</span>
                      を選んでリサーチを開始してください。
                    </p>
                    <div className="flex gap-2 mt-3">
                      {["ジャンル・ニッチ", "トーン・キャラ設定", "マネタイズ優先順位"].map(tag => (
                        <span key={tag} className="px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 text-[9px] font-semibold">未決定: {tag}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ヘッダー：3者会議の参加者説明 */}
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-white">🤝 3者会議室</h2>
                  {activeDirectives.length > 0 && (
                    <span className="px-2 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-[10px] text-indigo-300">
                      📌 {activeDirectives.length}件稼働中
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <p className="text-lg mb-1">🤖</p>
                    <p className="text-[11px] font-semibold text-blue-300">o3 Thinking</p>
                    <p className="text-[10px] text-blue-300/60 mt-0.5">データ分析・立論</p>
                  </div>
                  <div className="p-3 rounded-lg bg-violet-500/10 border border-violet-500/20">
                    <p className="text-lg mb-1">🧠</p>
                    <p className="text-[11px] font-semibold text-violet-300">Claude Sonnet</p>
                    <p className="text-[10px] text-violet-300/60 mt-0.5">リスク評価・最終統合</p>
                  </div>
                  <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
                    <p className="text-lg mb-1">🦅</p>
                    <p className="text-[11px] font-semibold text-orange-300">Grok (X情報官)</p>
                    <p className="text-[10px] text-orange-300/60 mt-0.5">X現場・ファクトチェック</p>
                  </div>
                </div>
                <p className="text-[10px] text-white/30 mt-2 text-center">
                  Webリサーチ → 5ラウンド3者ディベート（GPT立論 → Claude反論 → Grok裁定）→ あなたが最終決定
                </p>
              </div>

              {/* ── STEP 1: Deep Research ── */}
              <div className="rounded-xl border border-white/8 bg-white/5 p-4">
                <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">
                  STEP 1 — Deep Research 起動
                </h2>
                <p className="text-[10px] text-white/40 mb-2">クイック選択：</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
                  {PRESET_TOPICS.map((t, i) => (
                    <button
                      key={i}
                      onClick={() => setResearchTopic(t)}
                      disabled={researchLoading}
                      className="text-left text-[10px] text-white/50 p-2.5 rounded-lg bg-white/5 border border-white/8 hover:bg-indigo-500/10 hover:border-indigo-500/30 hover:text-indigo-300 transition-all line-clamp-2 disabled:opacity-40"
                    >
                      {["🔍", "💰", "📡", "💬"][i]} {t.slice(0, 60)}...
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-white/40 mb-1.5">またはカスタムトピックを入力：</p>
                <textarea
                  value={researchTopic}
                  onChange={(e) => setResearchTopic(e.target.value)}
                  placeholder="例: シャドウバン回復後の投稿頻度の最適化について..."
                  rows={3}
                  disabled={researchLoading}
                  className="w-full text-xs bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/20 focus:outline-none focus:border-indigo-500/50 resize-none mb-3 disabled:opacity-40"
                />
                <button
                  onClick={() => startResearch(researchTopic)}
                  disabled={researchLoading || !researchTopic.trim()}
                  className="w-full py-2.5 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-medium hover:bg-indigo-500/30 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {researchLoading ? (
                    <><span className="animate-spin text-base">⟳</span>GPT がウェブ検索中... しばらくお待ちください</>
                  ) : <>🔍 Deep Research 起動</>}
                </button>
                {researchError && (
                  <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">❌ {researchError}</div>
                )}
                {researchResult && (
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-emerald-400 mb-0.5">✅ リサーチ完了</p>
                        <p className="text-[10px] text-white/30">
                          {researchResult.model} / {Math.round((new Date(researchResult.completedAt).getTime() - new Date(researchResult.startedAt).getTime()) / 1000)}秒
                        </p>
                      </div>
                      <button
                        onClick={startMeeting}
                        disabled={meetingCreating}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-medium hover:bg-emerald-500/30 transition-colors disabled:opacity-40"
                      >
                        {meetingCreating ? "作成中..." : "💬 会議スタート →"}
                      </button>
                    </div>
                    <div className="rounded-lg bg-black/30 border border-white/8 p-4 max-h-80 overflow-y-auto">
                      <p className="text-xs text-white/70 whitespace-pre-wrap leading-relaxed">{researchResult.result}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* ── STEP 2: 3者議論 ── */}
              {meetingSession && (
                <div className="rounded-xl border border-white/10 bg-white/3 p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider">
                      STEP 2 — 3者議論
                    </h2>
                    <span className="text-[10px] text-white/30">{meetingSession.messages.length}発言</span>
                  </div>

                  {/* メッセージ履歴 */}
                  <div className="space-y-3 max-h-[36rem] overflow-y-auto mb-4 pr-1">
                    {meetingSession.messages.length === 0 && (
                      <div className="text-center py-8">
                        <p className="text-2xl mb-2">🎙</p>
                        <p className="text-xs text-white/40">議題を入力して「3者会議」を押してください</p>
                        <p className="text-[10px] text-white/25 mt-1">o3(立論) → Claude(反論) → Grok(X情報・裁定)の順で5ラウンド討論します</p>
                      </div>
                    )}
                    {meetingSession.messages.map((m, i) => {
                      const sp = speakerStyle[m.speaker ?? (m.role === "user" ? "user" : "gpt")];
                      const isUser = m.speaker === "user";
                      return (
                        <div key={i} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[90%] rounded-xl px-3 py-2.5 ${sp.bg} border ${sp.border}`}>
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <span className={`text-[10px] font-medium ${sp.text.replace("100", "400")}`}>{sp.label}</span>
                              <span className="text-[10px] text-white/20">{fmtDate(m.at).slice(5)}</span>
                              {!isUser && m.speaker !== "system" && (
                                <button
                                  onClick={() => setDirModal({ text: m.content.slice(0, 600), source: `会議: ${meetingSession.title}` })}
                                  className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/30 hover:text-white/60 hover:bg-white/10 transition-colors"
                                >
                                  📌 保存
                                </button>
                              )}
                            </div>
                            <p className={`text-xs leading-relaxed whitespace-pre-wrap ${sp.text}`}>{m.content}</p>
                          </div>
                        </div>
                      );
                    })}
                    {meetingLoading && (
                      <div className="space-y-2">
                        {sendMode === "trialogue" ? (
                          <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-[10px] text-white/50 font-medium">🎙 3者ディベート中</p>
                              <span className="text-[10px] text-indigo-300 font-bold">ラウンド {trialoguRound} / 5</span>
                            </div>
                            {/* プログレスバー */}
                            <div className="w-full h-1 bg-white/10 rounded-full mb-3">
                              <div
                                className="h-1 rounded-full bg-gradient-to-r from-blue-400 to-violet-400 transition-all duration-500"
                                style={{ width: `${(trialoguRound / 5) * 100}%` }}
                              />
                            </div>
                            {/* ライブスコアバー */}
                            {(cumulativeScores.gpt > 0 || cumulativeScores.claude > 0) && (() => {
                              const maxS = 5 * 10;
                              const gPct = Math.round((cumulativeScores.gpt / maxS) * 100);
                              const cPct = Math.round((cumulativeScores.claude / maxS) * 100);
                              return (
                                <div className="mb-3 p-2 rounded-lg bg-white/5 border border-white/8">
                                  <p className="text-[9px] text-orange-400 font-bold mb-1.5">🦅 Grok採点 — 累積スコア</p>
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-[9px] text-blue-300 w-12">🤖 o3</span>
                                    <div className="flex-1 h-1.5 bg-white/10 rounded-full">
                                      <div className="h-1.5 rounded-full bg-blue-400 transition-all duration-700" style={{ width: `${gPct}%` }} />
                                    </div>
                                    <span className="text-[9px] text-blue-300 font-mono">{cumulativeScores.gpt}pt</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[9px] text-violet-300 w-12">🧠 Claude</span>
                                    <div className="flex-1 h-1.5 bg-white/10 rounded-full">
                                      <div className="h-1.5 rounded-full bg-violet-400 transition-all duration-700" style={{ width: `${cPct}%` }} />
                                    </div>
                                    <span className="text-[9px] text-violet-300 font-mono">{cumulativeScores.claude}pt</span>
                                  </div>
                                </div>
                              );
                            })()}
                            <div className="space-y-1">
                              {[
                                { icon: "🤖", label: "o3 Thinking が立論中..." },
                                { icon: "🧠", label: "Claude が応答中..." },
                                { icon: "🦅", label: "Grok が採点中..." },
                              ].map((step, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <span className="text-xs">{step.icon}</span>
                                  <p className="text-[10px] text-white/35 animate-pulse">{step.label}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : sendMode === "gpt" ? (
                          <div className="bg-blue-500/10 border border-blue-500/25 rounded-xl px-3 py-2.5">
                            <p className="text-[10px] text-blue-400 mb-1">🤖 o3 Thinking</p>
                            <p className="text-xs text-blue-300/50 animate-pulse">推論中...</p>
                          </div>
                        ) : (
                          <div className="bg-violet-500/10 border border-violet-500/25 rounded-xl px-3 py-2.5">
                            <p className="text-[10px] text-violet-400 mb-1">🧠 Claude Sonnet</p>
                            <p className="text-xs text-violet-300/50 animate-pulse">考え中...</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 送信モード選択 */}
                  <div className="mb-3">
                    <p className="text-[10px] text-white/30 mb-1.5">送信先：</p>
                    <div className="flex gap-2">
                      {([
                        { mode: "trialogue" as const, label: "🎙 3者会議", desc: "5ラウンドディベート", active: "bg-gradient-to-r from-blue-500/20 to-violet-500/20 border-indigo-400/40 text-white" },
                        { mode: "gpt"       as const, label: "🤖 o3のみ",  desc: "推論・リサーチ",     active: "bg-blue-500/20 border-blue-400/40 text-blue-200" },
                        { mode: "claude"    as const, label: "🧠 Claudeのみ", desc: "実装観点の意見",  active: "bg-violet-500/20 border-violet-400/40 text-violet-200" },
                      ] as const).map(({ mode, label, desc, active }) => (
                        <button
                          key={mode}
                          onClick={() => setSendMode(mode)}
                          className={`flex-1 py-2 px-2 rounded-lg border text-[10px] font-medium transition-all ${
                            sendMode === mode
                              ? active
                              : "bg-white/5 border-white/10 text-white/30 hover:bg-white/10 hover:text-white/50"
                          }`}
                        >
                          <div>{label}</div>
                          <div className="text-[9px] font-normal opacity-60 mt-0.5">{desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 入力エリア */}
                  <div className="flex gap-2 mb-3">
                    <textarea
                      value={meetingInput}
                      onChange={(e) => setMeetingInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                      placeholder={
                        sendMode === "trialogue"
                          ? "議題を入力... o3→Claude→Grokの順で5ラウンド討論 (Enter送信)"
                          : sendMode === "gpt"
                          ? "o3 Thinkingへの質問... (Enter送信)"
                          : "Claudeへの質問... (Enter送信)"
                      }
                      rows={2}
                      disabled={meetingLoading}
                      className="flex-1 text-xs bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/20 focus:outline-none focus:border-indigo-500/40 resize-none disabled:opacity-40"
                    />
                    <button
                      onClick={sendMessage}
                      disabled={meetingLoading || !meetingInput.trim()}
                      className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-40 self-end shrink-0 border ${
                        sendMode === "trialogue"
                          ? "bg-indigo-500/25 text-white border-indigo-400/40 hover:bg-indigo-500/40"
                          : sendMode === "gpt"
                          ? "bg-blue-500/20 text-blue-300 border-blue-400/30 hover:bg-blue-500/30"
                          : "bg-violet-500/20 text-violet-300 border-violet-400/30 hover:bg-violet-500/30"
                      }`}
                    >
                      {meetingLoading ? "⟳" : "送信"}
                    </button>
                  </div>

                  {/* クイック議題 */}
                  <div className="mb-4">
                    <p className="text-[10px] text-white/25 mb-1.5">クイック議題：</p>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        "今すぐ実装すべき最優先施策は何か？",
                        "投稿本数を増やす最適なタイミングと条件は？",
                        "現在のリスクと対策を整理してほしい",
                        "3ヶ月後の目標と必要なアクションを提案して",
                        "決定事項の進捗を評価して次のアクションを決めたい",
                      ].map((q) => (
                        <button
                          key={q}
                          onClick={() => setMeetingInput(q)}
                          disabled={meetingLoading}
                          className="text-[10px] px-2 py-1 rounded-full bg-white/5 border border-white/8 text-white/35 hover:text-white/65 hover:bg-white/10 transition-colors disabled:opacity-40"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 決定事項自動抽出ボタン */}
                  {meetingSession.messages.filter((m) => m.role === "assistant").length >= 2 && (
                    <div className="border-t border-white/8 pt-3">
                      <button
                        onClick={extractDecisionsFromSession}
                        disabled={extractLoading}
                        className="w-full py-2.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 text-xs font-medium hover:bg-emerald-500/25 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                      >
                        {extractLoading ? (
                          <><span className="animate-spin text-base">⟳</span>Claudeが議事録を解析中...</>
                        ) : (
                          <>💡 Claudeが決定事項を自動抽出する</>
                        )}
                      </button>
                      <p className="text-[10px] text-white/20 text-center mt-1">会議の内容からClaudeが実行可能な決定候補を3〜6件提案します</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── Grok最終裁定パネル（5ラウンド完了後）── */}
              {debateCompleted && meetingSession && (cumulativeScores.gpt > 0 || cumulativeScores.claude > 0) && (
                <div className="rounded-xl border border-orange-500/30 bg-gradient-to-b from-orange-500/8 to-transparent p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-base">🦅</span>
                    <div>
                      <h2 className="text-xs font-bold text-orange-300">Grok 最終採点結果</h2>
                      <p className="text-[10px] text-white/30">5ラウンド合計スコアによる自律裁定</p>
                    </div>
                    {grokVerdict && (
                      <span className="ml-auto px-2 py-0.5 rounded-full bg-orange-500/20 border border-orange-500/30 text-[9px] text-orange-300 font-bold">
                        🏆 {grokVerdict.winner}案採用
                      </span>
                    )}
                  </div>
                  {/* スコアバー */}
                  {(() => {
                    const maxS = 50;
                    const gPct = Math.round((cumulativeScores.gpt / maxS) * 100);
                    const cPct = Math.round((cumulativeScores.claude / maxS) * 100);
                    const gWin = cumulativeScores.gpt > cumulativeScores.claude;
                    const cWin = cumulativeScores.claude > cumulativeScores.gpt;
                    return (
                      <div className="space-y-2 mb-3">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] w-16 font-bold ${gWin ? "text-blue-300" : "text-white/40"}`}>🤖 o3 {gWin ? "👑" : ""}</span>
                          <div className="flex-1 h-2 bg-white/10 rounded-full">
                            <div className="h-2 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-1000" style={{ width: `${gPct}%` }} />
                          </div>
                          <span className="text-[10px] font-mono text-blue-300">{cumulativeScores.gpt} / 50</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] w-16 font-bold ${cWin ? "text-violet-300" : "text-white/40"}`}>🧠 Claude {cWin ? "👑" : ""}</span>
                          <div className="flex-1 h-2 bg-white/10 rounded-full">
                            <div className="h-2 rounded-full bg-gradient-to-r from-violet-500 to-violet-400 transition-all duration-1000" style={{ width: `${cPct}%` }} />
                          </div>
                          <span className="text-[10px] font-mono text-violet-300">{cumulativeScores.claude} / 50</span>
                        </div>
                      </div>
                    );
                  })()}
                  {/* Grok裁定ディレクティブ */}
                  {grokVerdict?.directive && (
                    <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/25 p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded font-bold">✅ 自律実行指令 — 自動保存済み</span>
                      </div>
                      <p className="text-xs text-emerald-200/80 leading-relaxed">{grokVerdict.directive.text}</p>
                      <p className="text-[9px] text-white/25 mt-1.5">翌07:30 cronが自動実行します • assignee: ai • priority: high</p>
                    </div>
                  )}
                  {!grokVerdict?.directive && (
                    <p className="text-[10px] text-white/25 text-center py-1">Grokのスコアフォーマット解析中... 発言内容を確認してください</p>
                  )}
                </div>
              )}

              {/* ── Q&Aラウンド（5ラウンド完了後）── */}
              {debateCompleted && meetingSession && (
                <div className={`rounded-xl border p-4 ${qaRoundsLeft > 0 ? "border-amber-500/25 bg-amber-500/5" : "border-white/8 bg-white/3"}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h2 className="text-xs font-semibold text-amber-400/80 uppercase tracking-wider">
                        💬 Q&Aラウンド — あなたからの質問
                      </h2>
                      <p className="text-[10px] text-white/30 mt-0.5">
                        o3・Claude・Grokがあなたの質問に直接回答します
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {[0, 1].map((i) => (
                        <span key={i} className={`w-2.5 h-2.5 rounded-full ${i < qaRoundsLeft ? "bg-amber-400" : "bg-white/15"}`} />
                      ))}
                      <span className="text-[10px] text-amber-400/70 ml-1">{qaRoundsLeft}回残り</span>
                    </div>
                  </div>

                  {qaRoundsLeft > 0 ? (
                    <>
                      <div className="flex gap-2 mb-2">
                        <textarea
                          value={qaInput}
                          onChange={(e) => setQaInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQAMessage(); } }}
                          placeholder="ディベートを受けて疑問点・確認したいことを入力... (Enter送信)"
                          rows={2}
                          disabled={qaLoading}
                          className="flex-1 text-xs bg-white/5 border border-amber-500/20 rounded-lg px-3 py-2 text-white placeholder-white/20 focus:outline-none focus:border-amber-400/40 resize-none disabled:opacity-40"
                        />
                        <button
                          onClick={sendQAMessage}
                          disabled={qaLoading || !qaInput.trim()}
                          className="px-4 py-2 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold hover:bg-amber-500/30 transition-colors disabled:opacity-40 self-end shrink-0"
                        >
                          {qaLoading ? "⟳" : "質問"}
                        </button>
                      </div>
                      {qaLoading && (
                        <div className="flex gap-2 mt-2 flex-wrap">
                          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
                            <p className="text-[10px] text-blue-400 animate-pulse">🤖 o3 回答中...</p>
                          </div>
                          <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg px-3 py-2">
                            <p className="text-[10px] text-violet-400 animate-pulse">🧠 Claude 回答中...</p>
                          </div>
                          <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2">
                            <p className="text-[10px] text-orange-400 animate-pulse">🦅 Grok 回答中...</p>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-[10px] text-white/30 text-center py-2">Q&Aラウンド終了。「💡 決定事項を自動抽出する」で内容を保存してください。</p>
                  )}
                </div>
              )}

              {/* ── STEP 3: 決定候補の確認・採用 ── */}
              {candidates.length > 0 && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                      STEP 3 — 決定事項の確認・採用
                    </h2>
                    <span className="text-[10px] text-emerald-400/60">{candidates.length}件の候補</span>
                  </div>
                  <p className="text-[10px] text-white/40 mb-3">以下の決定候補を確認してください。「✅ 採用」で即座にボットの全コンテキストに反映されます。</p>
                  <div className="space-y-3">
                    {candidates.map((c) => (
                      <div key={c.id} className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                        <span className="shrink-0 mt-0.5">{priIcon[c.priority]}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-white/85 leading-relaxed mb-1">{c.text}</p>
                          <p className="text-[10px] text-white/35 italic mb-1">根拠: {c.rationale}</p>
                          {c.successCriteria && (
                            <p className="text-[10px] text-emerald-400/60 mb-2">🎯 成功基準: {c.successCriteria}</p>
                          )}
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${catColor[c.category]}`}>{c.category}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-white/30">{c.assignee}</span>
                          </div>
                        </div>
                        <div className="shrink-0 flex flex-col gap-1.5">
                          <button
                            onClick={() => adoptCandidate(c)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold hover:bg-emerald-500/35 transition-colors"
                          >
                            ✅ 採用
                          </button>
                          <button
                            onClick={() => { setCandidates((prev) => prev.filter((x) => x.id !== c.id)); }}
                            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/30 text-[10px] hover:bg-red-500/10 hover:text-red-400 transition-colors"
                          >
                            ✖ 却下
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── STEP 4: 実施中のこと（役割別アクションボード）── */}
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-semibold text-indigo-400/70 uppercase tracking-wider">
                    STEP 4 — 📋 実施中のこと
                  </h2>
                  <button
                    onClick={() => setDirModal({ text: "", source: "手動入力" })}
                    className="text-[10px] px-2.5 py-1 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/30 transition-colors"
                  >
                    ＋ 手動で追加
                  </button>
                </div>

                {allDirectives.filter((d) => d.status === "active").length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-xs text-white/30">実施中の決定事項はまだありません</p>
                    <p className="text-[10px] text-white/20 mt-1">決定候補を採用すると、役割別にここに表示されます</p>
                  </div>
                ) : (() => {
                  const activeItems = allDirectives.filter((d) => d.status === "active");
                  const groups: { key: Assignee; icon: string; label: string; color: string; border: string; bg: string }[] = [
                    { key: "user",   icon: "👤", label: "私がやること",         color: "text-indigo-300", border: "border-indigo-500/25", bg: "bg-indigo-500/8" },
                    { key: "ai",     icon: "🤖", label: "AIが自動でやること",   color: "text-blue-300",   border: "border-blue-500/25",   bg: "bg-blue-500/8"   },
                    { key: "others", icon: "👥", label: "その他の人がやること", color: "text-emerald-300", border: "border-emerald-500/25", bg: "bg-emerald-500/8" },
                  ];
                  return (
                    <div className="space-y-4">
                      {groups.map(({ key, icon, label, color, border, bg }) => {
                        const items = activeItems.filter((d) => (d.assignee ?? "user") === key);
                        if (items.length === 0) return null;
                        return (
                          <div key={key} className={`rounded-lg border ${border} ${bg} p-3`}>
                            <p className={`text-[11px] font-semibold ${color} mb-2.5 flex items-center gap-1.5`}>
                              <span>{icon}</span>{label}
                              <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-white/8 border border-white/10 text-white/40`}>{items.length}件</span>
                            </p>
                            <div className="space-y-2">
                              {items.map((d) => {
                                const isExecRunning = executingId === d.id;
                                const lastExec = d.executionLog?.[0];
                                return (
                                  <div key={d.id} className="group">
                                    <div className="flex items-start gap-2">
                                      <span className="shrink-0 mt-0.5">{priIcon[d.priority]}</span>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-[11px] text-white/85 leading-snug">{d.text}</p>
                                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                          <span className={`text-[9px] px-1.5 py-0.5 rounded border ${catColor[d.category]}`}>{d.category}</span>
                                          {/* プラットフォームバッジ：X/Threadsの決定事項を視覚的に分離 */}
                                          {(d.platform ?? "x") === "x"
                                            ? <span className="text-[9px] px-1.5 py-0.5 rounded border border-sky-500/30 bg-sky-500/10 text-sky-300 font-bold">𝕏 X</span>
                                            : <span className="text-[9px] px-1.5 py-0.5 rounded border border-purple-500/30 bg-purple-500/10 text-purple-300 font-bold">🪡 Threads</span>
                                          }
                                          <span className="text-[9px] px-1.5 py-0.5 rounded border border-emerald-500/20 bg-emerald-500/8 text-emerald-400">● 実施中</span>
                                          <span className="text-[9px] text-white/25">{d.source}</span>
                                          {lastExec && (
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded border ${lastExec.success ? "border-blue-500/30 bg-blue-500/10 text-blue-400" : "border-orange-500/30 bg-orange-500/8 text-orange-400"}`}>
                                              {lastExec.success ? "⚡ 実行済" : "⚠ 手動必要"}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="shrink-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        {d.assignee === "ai" && (
                                          <button
                                            onClick={() => runExecuteDirective(d.id)}
                                            disabled={isExecRunning}
                                            className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 border border-blue-500/25 text-blue-300 hover:bg-blue-500/30 transition-colors disabled:opacity-40"
                                          >
                                            {isExecRunning ? "実行中..." : "⚡ 実行"}
                                          </button>
                                        )}
                                        <button onClick={() => updateStatus(d.id, "completed")} className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors">✓完了</button>
                                        <button onClick={() => updateStatus(d.id, "cancelled")} className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/15 text-red-400/70 hover:bg-red-500/20 transition-colors">✕</button>
                                      </div>
                                    </div>
                                    {/* 実行ログ表示 */}
                                    {lastExec && (
                                      <div className={`mt-1.5 ml-5 rounded p-2 text-[9px] ${lastExec.success ? "bg-blue-500/8 border border-blue-500/15" : "bg-orange-500/8 border border-orange-500/15"}`}>
                                        <p className={`font-medium mb-0.5 ${lastExec.success ? "text-blue-300" : "text-orange-300"}`}>
                                          {lastExec.success ? "⚡" : "⚠"} {lastExec.summary}
                                        </p>
                                        {lastExec.changes.length > 0 && (
                                          <ul className="text-white/40 space-y-0.5">
                                            {lastExec.changes.map((c, i) => <li key={i}>• {c}</li>)}
                                          </ul>
                                        )}
                                        <p className="text-white/20 mt-0.5">{lastExec.at.slice(0, 16).replace("T", " ")}</p>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* 完了・取消済みアーカイブ */}
                {allDirectives.filter((d) => d.status !== "active").length > 0 && (
                  <details className="mt-4">
                    <summary className="text-[10px] text-white/25 cursor-pointer hover:text-white/40 transition-colors">
                      アーカイブ（完了・取消）{allDirectives.filter((d) => d.status !== "active").length}件
                    </summary>
                    <div className="mt-2 space-y-2">
                    {["completed", "cancelled"].map((statusGroup) => {
                      const items = allDirectives.filter((d) => d.status === statusGroup);
                      if (items.length === 0) return null;
                      const groupLabel: Record<string, string> = { completed: "☑️ 完了", cancelled: "✖️ キャンセル" };
                      const groupOpacity: Record<string, string> = { completed: "opacity-50", cancelled: "opacity-30" };
                      return (
                        <div key={statusGroup}>
                          <p className="text-[10px] text-white/30 mb-1.5">{groupLabel[statusGroup]} ({items.length}件)</p>
                          <div className={`space-y-2 ${groupOpacity[statusGroup]}`}>
                            {items.map((d) => (
                              <div key={d.id} className="flex items-start gap-2 p-3 rounded-lg bg-white/5 border border-white/8">
                                <span className="shrink-0 mt-0.5 text-xs">{priIcon[d.priority]}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs text-white/80 leading-relaxed mb-1.5">{d.text}</p>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${catColor[d.category]}`}>{d.category}</span>
                                    <span className="text-[10px] text-white/25">{d.source}</span>
                                    <span className="text-[10px] text-white/20">{fmtDate(d.createdAt).slice(0, 10)}</span>
                                    {d.status === "active" && (
                                      <div className="ml-auto flex gap-1.5">
                                        <button
                                          onClick={() => updateStatus(d.id, "completed")}
                                          className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/25 transition-colors"
                                        >完了</button>
                                        <button
                                          onClick={() => updateStatus(d.id, "cancelled")}
                                          className="text-[10px] px-2 py-0.5 rounded bg-white/5 border border-white/10 text-white/30 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                                        >取消</button>
                                      </div>
                                    )}
                                    {d.status !== "active" && (
                                      <button
                                        onClick={() => updateStatus(d.id, "active")}
                                        className="ml-auto text-[10px] px-2 py-0.5 rounded bg-white/5 border border-white/10 text-white/30 hover:bg-indigo-500/10 hover:text-indigo-400 transition-colors"
                                      >再開</button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  </details>
                )}
              </div>

              {/* ── 決定事項保存モーダル ── */}
              {dirModal !== null && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setDirModal(null)}>
                  <div className="bg-[#0d1529] border border-indigo-500/30 rounded-xl p-5 w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
                    <h3 className="text-sm font-bold text-indigo-300 mb-3">📌 決定事項として保存</h3>
                    <textarea
                      value={dirModal.text}
                      onChange={(e) => setDirModal({ ...dirModal, text: e.target.value })}
                      placeholder="決定した内容を入力してください..."
                      rows={4}
                      className="w-full text-xs bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/20 focus:outline-none focus:border-indigo-500/50 resize-none mb-3"
                    />
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div>
                        <p className="text-[10px] text-white/40 mb-1.5">カテゴリ</p>
                        <div className="flex flex-wrap gap-1.5">
                          {catOptions.map((c) => (
                            <button
                              key={c.value}
                              onClick={() => setDirForm((f) => ({ ...f, category: c.value }))}
                              className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                                dirForm.category === c.value
                                  ? catColor[c.value] + " font-medium"
                                  : "border-white/10 bg-white/5 text-white/40 hover:bg-white/10"
                              }`}
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] text-white/40 mb-1.5">優先度</p>
                        <div className="flex gap-1.5">
                          {priOptions.map((p) => (
                            <button
                              key={p.value}
                              onClick={() => setDirForm((f) => ({ ...f, priority: p.value }))}
                              className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                                dirForm.priority === p.value
                                  ? `${p.color} border-current bg-white/10 font-medium`
                                  : "border-white/10 bg-white/5 text-white/40 hover:bg-white/10"
                              }`}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="mb-4">
                      <p className="text-[10px] text-white/40 mb-1.5">担当者</p>
                      <div className="flex gap-2">
                        {([
                          { value: "user" as Assignee, icon: "👤", label: "私がやる" },
                          { value: "ai" as Assignee, icon: "🤖", label: "AIが自動" },
                          { value: "others" as Assignee, icon: "👥", label: "その他の人" },
                        ]).map((a) => (
                          <button
                            key={a.value}
                            onClick={() => setDirForm((f) => ({ ...f, assignee: a.value }))}
                            className={`text-[10px] px-2.5 py-1 rounded border transition-colors flex items-center gap-1 ${
                              dirForm.assignee === a.value
                                ? "border-indigo-400/40 bg-indigo-500/20 text-indigo-300 font-medium"
                                : "border-white/10 bg-white/5 text-white/40 hover:bg-white/10"
                            }`}
                          >
                            <span>{a.icon}</span>{a.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setDirModal(null)} className="px-3 py-1.5 rounded-lg text-xs text-white/40 hover:text-white/60 transition-colors">
                        キャンセル
                      </button>
                      <button
                        onClick={saveDirective}
                        disabled={dirSaving || !dirModal.text.trim()}
                        className="px-4 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-medium hover:bg-indigo-500/30 transition-colors disabled:opacity-40"
                      >
                        {dirSaving ? "保存中..." : "📌 保存してボットに反映"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          );
        })()}

        </div>{/* X コンテンツラッパー終了 */}
      </main>

      <footer className="border-t border-white/8 mt-8 py-3 text-center text-[10px] text-white/20">
        FANZA X Bot — 自律稼働中 · 30秒ごとに自動更新 🤖
      </footer>

      {/* ════ クイック設定モーダル ════ */}
      {qcOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d1529] shadow-2xl">
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/8">
              <div>
                <h2 className="text-sm font-semibold text-white">⚙️ クイック設定</h2>
                <p className="text-xs text-white/40 mt-0.5">設定したいことを自然言語で入力 → AIが即時実行</p>
              </div>
              <button onClick={() => setQcOpen(false)} className="text-white/30 hover:text-white/60 transition-colors text-lg leading-none">✕</button>
            </div>

            {/* 入力フォーム */}
            <div className="p-5 space-y-3">
              <textarea
                value={qcInput}
                onChange={(e) => setQcInput(e.target.value)}
                disabled={qcLoading}
                placeholder={"例: buzzの重みを3に上げて\n例: 投稿間隔を2時間にして\n例: amateur系テンプレートを3件追加して"}
                rows={4}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/25 resize-none focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
              />

              {/* クイックプリセット */}
              <div className="flex flex-wrap gap-1.5">
                {[
                  "buzzの重みを2.5に",
                  "amateurを強化して",
                  "テンプレを3件追加",
                  "監視間隔を2時間に",
                ].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setQcInput(preset)}
                    disabled={qcLoading}
                    className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-[11px] text-white/50 hover:text-white/80 hover:border-white/20 transition-colors disabled:opacity-40"
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <button
                onClick={async () => {
                  if (!qcInput.trim() || qcLoading) return;
                  setQcLoading(true);
                  setQcResult(null);
                  try {
                    const res = await fetch(`${API}/api/bot/quick-config`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ instruction: qcInput.trim() }),
                    });
                    const data: QuickConfigResult = await res.json();
                    setQcResult(data);
                  } catch {
                    setQcResult({ execution: { actionType: "error", summary: "通信エラー", changes: [], success: false } });
                  } finally {
                    setQcLoading(false);
                  }
                }}
                disabled={qcLoading || !qcInput.trim()}
                className="w-full py-2.5 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-sm font-medium hover:bg-indigo-500/30 transition-colors disabled:opacity-40"
              >
                {qcLoading ? "⏳ 実行中..." : "⚡ 今すぐ実行"}
              </button>

              {/* 実行結果 */}
              {qcResult && (
                <div className={`rounded-xl border p-3 ${
                  qcResult.execution.success
                    ? "border-emerald-500/30 bg-emerald-500/10"
                    : "border-red-500/30 bg-red-500/10"
                }`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm">{qcResult.execution.success ? "✅" : "⚠️"}</span>
                    <span className="text-sm font-medium text-white">{qcResult.execution.summary}</span>
                  </div>
                  {qcResult.execution.changes.length > 0 && (
                    <ul className="space-y-0.5 mt-1">
                      {qcResult.execution.changes.map((c, i) => (
                        <li key={i} className="text-xs text-white/60 pl-2">・{c}</li>
                      ))}
                    </ul>
                  )}
                  {qcResult.execution.success && (
                    <button
                      onClick={() => { setQcOpen(false); setQcInput(""); setQcResult(null); }}
                      className="mt-2 text-xs text-indigo-300 hover:text-indigo-200 transition-colors"
                    >
                      閉じる →
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "manual-fb" && (
        <div className="p-4">
          <ManualFeedbackPanel
            feedbacks={manualFbData?.feedbacks ?? []}
            onRun={() => refetchManualFb()}
          />
        </div>
      )}

      {tab === "algo" && (
        <div className="p-4 space-y-4">
          {/* ヘッダー */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold">📡 Xアルゴリズム解析</h2>
              <p className="text-xs text-white/40 mt-0.5">実投稿データのみ分析 / Claude(分析) × o3(批判) 議論形式 / 日曜23:30 JST 自動実行</p>
            </div>
            <button
              onClick={async () => {
                setAlgoRunning(true);
                try {
                  const res = await fetch(`${API}/api/bot/algo-insights/run`, { method: "POST" });
                  const d = await res.json();
                  if (d.error) alert(`エラー: ${d.error}`);
                  else await refetchAlgo();
                } catch { alert("実行失敗"); }
                setAlgoRunning(false);
              }}
              disabled={algoRunning}
              className="text-xs bg-purple-600/20 border border-purple-500/30 rounded px-3 py-1.5 hover:bg-purple-600/30 disabled:opacity-50"
            >
              {algoRunning ? "⏳ 解析中... (1〜2分)" : "🔬 今すぐ解析"}
            </button>
          </div>

          {/* 知識ベース（折りたたみ） */}
          {algoKbData && (
            <div className="border border-white/10 rounded-lg overflow-hidden">
              <button
                onClick={() => setAlgoKbOpen(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2 bg-white/5 hover:bg-white/10 text-xs"
              >
                <span className="font-semibold text-amber-400">📚 Xアルゴリズム知識ベース (v{algoKbData.version}) — 出典付き確認済みルール</span>
                <span className="text-white/40">{algoKbOpen ? "▲ 閉じる" : "▼ 展開"}</span>
              </button>

              {algoKbOpen && (
                <div className="p-3 space-y-4">
                  {/* 出典凡例 */}
                  <div className="bg-white/5 rounded p-2 space-y-0.5">
                    <p className="text-[11px] font-semibold text-white/50 mb-1">出典凡例</p>
                    {algoKbData.sources.map(s => (
                      <p key={s} className="text-[11px] text-white/40">{s}</p>
                    ))}
                  </div>

                  {/* スコアリングルール */}
                  <div>
                    <p className="text-xs font-semibold text-purple-400 mb-2">⚖️ スコアリングルール（確認済み）</p>
                    <div className="space-y-2">
                      {algoKbData.scoring.map(r => (
                        <div key={r.rule} className="bg-purple-900/20 border border-purple-500/20 rounded p-2 space-y-1">
                          <div className="flex items-start gap-2">
                            <span className="text-[10px] bg-purple-700/50 text-purple-300 rounded px-1 shrink-0 mt-0.5">{r.source}</span>
                            <p className="text-xs text-white/80 font-semibold">{r.rule}</p>
                          </div>
                          <p className="text-[11px] text-white/50 pl-8">{r.detail}</p>
                          <p className="text-[11px] text-green-400 pl-8">→ {r.implication}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 配信パイプライン */}
                  <div>
                    <p className="text-xs font-semibold text-blue-400 mb-2">🔀 配信パイプライン</p>
                    <div className="space-y-2">
                      {algoKbData.pipeline.map(r => (
                        <div key={r.rule} className="bg-blue-900/20 border border-blue-500/20 rounded p-2 space-y-1">
                          <div className="flex items-start gap-2">
                            <span className="text-[10px] bg-blue-700/50 text-blue-300 rounded px-1 shrink-0 mt-0.5">{r.source}</span>
                            <p className="text-xs text-white/80 font-semibold">{r.rule}</p>
                          </div>
                          <p className="text-[11px] text-white/50 pl-8">{r.detail}</p>
                          <p className="text-[11px] text-green-400 pl-8">→ {r.implication}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* NSFW特有 */}
                  <div>
                    <p className="text-xs font-semibold text-red-400 mb-2">🔞 センシティブコンテンツ特有</p>
                    <div className="space-y-2">
                      {algoKbData.nsfw.map(r => (
                        <div key={r.rule} className="bg-red-900/20 border border-red-500/20 rounded p-2 space-y-1">
                          <div className="flex items-start gap-2">
                            <span className="text-[10px] bg-red-700/50 text-red-300 rounded px-1 shrink-0 mt-0.5">{r.source}</span>
                            <p className="text-xs text-white/80 font-semibold">{r.rule}</p>
                          </div>
                          <p className="text-[11px] text-white/50 pl-8">{r.detail}</p>
                          <p className="text-[11px] text-green-400 pl-8">→ {r.implication}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 未確認 */}
                  <div>
                    <p className="text-xs font-semibold text-white/30 mb-1">❓ 未確認・議論中（参考のみ）</p>
                    {algoKbData.uncertain.map(r => (
                      <p key={r.rule} className="text-[11px] text-white/30">• {r.rule} <span className="text-white/20">[{r.source}]</span></p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 🆕 新発見管理 */}
          <div className="border border-white/10 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-white/5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-amber-400">🆕 アルゴ新発見 情報管理</span>
                {(discoveryData?.meta?.pendingCount ?? 0) > 0 && (
                  <span className="text-[10px] bg-amber-500 text-black rounded-full px-1.5 py-0.5 font-bold">
                    {discoveryData!.meta.pendingCount} 件要確認
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {discoveryData?.meta?.lastSearchAt && (
                  <span className="text-[10px] text-white/30">
                    最終: {new Date(discoveryData.meta.lastSearchAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
                <button
                  onClick={async () => {
                    setAlgoNewsSearching(true);
                    try {
                      const res = await fetch(`${API}/api/bot/algo-discoveries/search`, { method: "POST" });
                      const d = await res.json();
                      if (d.error) alert(`エラー: ${d.error}`);
                      else { await refetchDiscoveries(); }
                    } catch { alert("検索失敗"); }
                    setAlgoNewsSearching(false);
                  }}
                  disabled={algoNewsSearching}
                  className="text-[10px] bg-amber-600/20 border border-amber-500/30 rounded px-2 py-1 hover:bg-amber-600/30 disabled:opacity-50"
                >
                  {algoNewsSearching ? "⏳ 検索中..." : "🔍 今すぐ検索"}
                </button>
              </div>
            </div>

            <div className="px-3 pb-3">
              {/* サブタブ */}
              <div className="flex gap-2 mt-2 mb-3">
                {([["pending", "⏳ 未確認"], ["adopted", "✅ 採用済み"], ["all", "📋 全件"]] as const).map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => setAlgoDiscoveryTab(v)}
                    className={`text-[10px] px-2 py-1 rounded ${algoDiscoveryTab === v ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "text-white/40 hover:text-white/60"}`}
                  >
                    {label}
                    {v === 'pending' && (discoveryData?.meta?.pendingCount ?? 0) > 0 && ` (${discoveryData!.meta.pendingCount})`}
                    {v === 'adopted' && (discoveryData?.meta?.adoptedCount ?? 0) > 0 && ` (${discoveryData!.meta.adoptedCount})`}
                  </button>
                ))}
              </div>

              {/* 発見リスト */}
              {(() => {
                const all = discoveryData?.discoveries ?? [];
                const filtered = algoDiscoveryTab === 'all' ? all
                  : all.filter(d => d.status === algoDiscoveryTab);
                if (filtered.length === 0) {
                  return (
                    <p className="text-xs text-white/30 py-2 text-center">
                      {algoDiscoveryTab === 'pending' ? "未確認の発見なし（毎週月曜 08:30 自動収集）" : "なし"}
                    </p>
                  );
                }
                return (
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {filtered.map((d) => {
                      const confColor = d.confidence === 'confirmed' ? 'text-green-400' : d.confidence === 'likely' ? 'text-yellow-400' : 'text-red-400';
                      const catLabel = { scoring: '⚖️', pipeline: '🔀', nsfw: '🔞', other: '📌' }[d.category];
                      return (
                        <div key={d.id} className={`bg-white/5 border rounded p-2 space-y-1.5 ${d.status === 'adopted' ? 'border-green-500/30' : d.status === 'rejected' ? 'border-white/5 opacity-40' : 'border-amber-500/20'}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                              <span className="text-[10px]">{catLabel}</span>
                              <span className={`text-[10px] font-bold ${confColor}`}>[{d.confidence}]</span>
                              <p className="text-xs text-white/80 font-semibold leading-tight truncate">{d.title}</p>
                            </div>
                            {d.status === 'pending' && (
                              <div className="flex gap-1 shrink-0">
                                <button
                                  onClick={async () => {
                                    await fetch(`${API}/api/bot/algo-discoveries/${d.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "adopted" }) });
                                    refetchDiscoveries();
                                  }}
                                  className="text-[10px] bg-green-600/20 border border-green-500/30 rounded px-1.5 py-0.5 hover:bg-green-600/40"
                                >採用</button>
                                <button
                                  onClick={async () => {
                                    await fetch(`${API}/api/bot/algo-discoveries/${d.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "rejected" }) });
                                    refetchDiscoveries();
                                  }}
                                  className="text-[10px] bg-red-600/10 border border-red-500/20 rounded px-1.5 py-0.5 hover:bg-red-600/20"
                                >棄却</button>
                              </div>
                            )}
                          </div>
                          <p className="text-[11px] text-white/50 leading-relaxed">{d.detail}</p>
                          {d.sourceUrl ? (
                            <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400 hover:underline block truncate">
                              🔗 {d.sourceDesc || d.sourceUrl}
                            </a>
                          ) : (
                            <p className="text-[10px] text-white/30">{d.sourceDesc}</p>
                          )}
                          <p className="text-[10px] text-white/20">
                            発見: {new Date(d.discoveredAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" })}
                            {d.reviewedAt && ` / 確認: ${new Date(d.reviewedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" })}`}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* 統計サマリー（常に表示） */}
          {algoData?.stats && (
            <div className="space-y-3">
              <p className="text-xs text-white/50">サンプル数: <span className="text-white font-bold">{algoData.stats.sampleSize}件</span>（サンプルが少ないため仮説レベル）</p>

              {/* タイプ別 */}
              <div className="bg-white/5 rounded-lg p-3 space-y-2">
                <h3 className="text-xs font-semibold text-purple-400">投稿タイプ別 平均インプレッション</h3>
                {algoData.stats.byType.map((t) => {
                  const max = Math.max(...algoData.stats.byType.map(x => x.avgImp), 1);
                  return (
                    <div key={t.type} className="space-y-0.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-white/70">{t.type} <span className="text-white/30">n={t.count}</span></span>
                        <span className="font-bold text-white">{t.avgImp.toLocaleString()} imp</span>
                      </div>
                      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-purple-500 rounded-full" style={{ width: `${Math.round(t.avgImp/max*100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 相関係数 */}
              <div className="bg-white/5 rounded-lg p-3 space-y-2">
                <h3 className="text-xs font-semibold text-blue-400">インプレッションとの相関係数</h3>
                <p className="text-[11px] text-white/30">|r|: &lt;0.2=無相関 / 0.2〜0.4=弱 / 0.4〜0.6=中 / &gt;0.6=強</p>
                {Object.entries(algoData.stats.correlations).map(([k, v]) => {
                  const num = isNaN(Number(v)) ? 0 : Number(v);
                  const color = Math.abs(num) > 0.4 ? "text-yellow-400" : Math.abs(num) > 0.2 ? "text-blue-400" : "text-white/40";
                  return (
                    <div key={k} className="flex items-center justify-between text-xs">
                      <span className="text-white/60">{k}</span>
                      <span className={`font-mono font-bold ${color}`}>{isNaN(Number(v)) ? "N/A" : Number(v).toFixed(3)}</span>
                    </div>
                  );
                })}
              </div>

              {/* 時間帯別 */}
              <div className="bg-white/5 rounded-lg p-3 space-y-1">
                <h3 className="text-xs font-semibold text-green-400">時間帯別 平均インプレッション</h3>
                <div className="grid grid-cols-4 gap-1 mt-2">
                  {algoData.stats.byHour.map((h) => {
                    const max = Math.max(...algoData.stats.byHour.map(x => x.avgImp), 1);
                    const pct = Math.round(h.avgImp / max * 100);
                    return (
                      <div key={h.hour} className="text-center space-y-1">
                        <div className="h-12 bg-white/10 rounded relative overflow-hidden flex items-end">
                          <div className="w-full bg-green-500/70 rounded" style={{ height: `${pct}%` }} />
                        </div>
                        <div className="text-[10px] text-white/50">{String(h.hour).padStart(2,"0")}時</div>
                        <div className="text-[10px] text-white/70">{h.avgImp}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* AI議論結果 */}
          {algoData?.latest ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-white/60">最新AI解析結果</h3>
                <span className="text-[11px] text-white/30">
                  {new Date(algoData.latest.generatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>

              {/* ブリーフィング */}
              <div className="bg-gradient-to-br from-purple-900/30 to-blue-900/30 border border-purple-500/20 rounded-lg p-3">
                <p className="text-xs font-semibold text-purple-300 mb-2">📋 今週のブリーフィング</p>
                <p className="text-xs text-white/80 whitespace-pre-wrap leading-relaxed">{algoData.latest.briefing}</p>
              </div>

              {/* 議論 */}
              {[
                { label: "🧠 Claude — 仮説・分析", key: "claudeHypothesis", color: "blue" },
                { label: "🤖 o3 — 批判的検証", key: "o3Challenge", color: "orange" },
                { label: "🧠 Claude — 統合・アクションプラン", key: "claudeSynthesis", color: "purple" },
              ].map(({ label, key, color }) => (
                <details key={key} className={`bg-${color}-500/5 border border-${color}-500/20 rounded-lg`}>
                  <summary className={`text-xs font-semibold text-${color}-400 p-3 cursor-pointer`}>{label}</summary>
                  <div className="px-3 pb-3">
                    <p className="text-xs text-white/70 whitespace-pre-wrap leading-relaxed">
                      {algoData.latest?.discussion[key as keyof typeof algoData.latest.discussion]}
                    </p>
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <div className="bg-white/5 border border-white/10 rounded-lg p-4 text-center">
              <p className="text-sm text-white/50">まだ解析データがありません</p>
              <p className="text-xs text-white/30 mt-1">「🔬 今すぐ解析」を押すと Claude × o3 の議論が始まります</p>
            </div>
          )}
        </div>
      )}

      {tab === "rebrandly" && (
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold">🔗 Rebrandly クリック追跡</h2>
              <p className="text-xs text-white/40 mt-0.5">毎日 06:00 JST に自動同期 / 短縮URLのクリック数を追跡</p>
            </div>
            <button
              onClick={async () => {
                try {
                  const res = await fetch(`${API}/api/bot/rebrandly/sync`, { method: "POST" });
                  const data = await res.json();
                  if (data.error) {
                    alert(`同期エラー: ${data.error}`);
                  } else {
                    await refetchRebrandly();
                  }
                } catch (e) {
                  alert("同期失敗");
                }
              }}
              disabled={rebrandlySyncing}
              className="text-xs bg-blue-600/20 border border-blue-500/30 rounded px-3 py-1.5 hover:bg-blue-600/30 disabled:opacity-50"
            >
              {rebrandlySyncing ? "同期中..." : "🔄 今すぐ同期"}
            </button>
          </div>

          {(!rebrandlyData?.links || rebrandlyData.links.length === 0) ? (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 space-y-2">
              <p className="text-sm font-semibold text-yellow-400">⚠️ データなし</p>
              <p className="text-xs text-white/60">
                <code className="bg-white/10 rounded px-1">REBRANDLY_API_KEY</code> を環境変数に設定すると自動同期が有効になります。
              </p>
              <p className="text-xs text-white/40">
                Rebrandly → Account Settings → API Keys からキーを取得してください。
              </p>
            </div>
          ) : (
            <>
              {/* サマリー */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white/5 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-blue-400">
                    {rebrandlyData.links.reduce((s, l) => s + l.clicks, 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-white/50 mt-1">総クリック数</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-purple-400">{rebrandlyData.links.length}</div>
                  <div className="text-xs text-white/50 mt-1">追跡リンク数</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3 text-center">
                  <div className="text-sm font-bold text-white/70">
                    {rebrandlyData.lastSyncedAt
                      ? new Date(rebrandlyData.lastSyncedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
                      : "—"}
                  </div>
                  <div className="text-xs text-white/50 mt-1">最終同期</div>
                </div>
              </div>

              {/* リンク一覧 */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wide">リンク別クリック数</h3>
                {[...rebrandlyData.links].sort((a, b) => b.clicks - a.clicks).map((link) => {
                  const maxClicks = Math.max(...rebrandlyData.links.map((l) => l.clicks), 1);
                  const pct = Math.round((link.clicks / maxClicks) * 100);
                  return (
                    <div key={link.id} className="bg-white/5 rounded-lg p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">{link.title || link.slashtag}</p>
                          <p className="text-[11px] text-white/40">re.bndly/{link.slashtag}</p>
                        </div>
                        <div className="text-right ml-3 flex-shrink-0">
                          <span className="text-lg font-bold text-blue-400">{link.clicks.toLocaleString()}</span>
                          <span className="text-xs text-white/40 ml-1">clicks</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ════ ボトムナビゲーション ════ */}
      <nav className="fixed bottom-0 left-0 right-0 bg-[#0a0f1e]/95 backdrop-blur-md border-t border-white/10 z-30">
        <div className="max-w-5xl mx-auto flex">
          {([
            { key: "home",     icon: "🏠", label: "ホーム",   setTo: "overview"  },
            { key: "posts",    icon: "📝", label: "投稿",     setTo: "posts"     },
            { key: "analysis", icon: "📊", label: "分析",     setTo: "algo"      },
            { key: "strategy", icon: "🧠", label: "戦略",     setTo: "strategy"  },
            { key: "admin",    icon: "⚙️", label: "管理",     setTo: "tasks"     },
          ] as const).map(item => {
            const isActive = mainTab === item.key;
            // バッジ計算
            const badge =
              item.key === "admin" && tasks
                ? tasks.daily.filter(t => t.assignee === "user" && !t.completed).length +
                  tasks.weekly.filter(t => t.assignee === "user" && !t.completed).length
                : item.key === "analysis" && (discoveryData?.meta?.pendingCount ?? 0) > 0
                ? (discoveryData?.meta?.pendingCount ?? 0)
                : 0;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.setTo as any)}
                className="flex-1 relative flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors"
              >
                <span className={`text-xl leading-none transition-transform ${isActive ? "scale-110" : "opacity-50"}`}>{item.icon}</span>
                <span className={`text-[10px] font-semibold tracking-wide transition-colors ${isActive ? "text-indigo-400" : "text-white/40"}`}>{item.label}</span>
                {isActive && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-indigo-400 rounded-full" />}
                {badge > 0 && (
                  <span className="absolute top-1.5 right-[calc(50%-14px)] min-w-[16px] h-4 px-1 bg-rose-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
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
