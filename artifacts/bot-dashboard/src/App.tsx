import { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  ResponsiveContainer, LineChart, Line, Cell,
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
  const m: Record<string, string> = { amateur: "素人", rank: "ランキング", sale: "セール", buzz: "バズ", random: "ランダム", celebrity: "芸能人似", external: "外部" };
  return m[t] ?? t;
}
function typeBadge(t: string) {
  const m: Record<string, string> = {
    amateur: "bg-rose-500/20 text-rose-300 border-rose-500/30",
    rank: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    sale: "bg-green-500/20 text-green-300 border-green-500/30",
    buzz: "bg-pink-500/20 text-pink-300 border-pink-500/30",
    random: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    celebrity: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    external: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  };
  return m[t] ?? "bg-gray-500/20 text-gray-300 border-gray-500/30";
}
function calcScore(m: Post["metrics"]) {
  if (!m) return 0;
  return m.like_count + m.retweet_count * 3 + (m.bookmark_count ?? 0) * 2 + (m.reply_count ?? 0);
}

// ─── コンポーネント ───────────────────────────────────────────────────────────

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
    pending:   { icon: "⏳", cls: "border-white/10 bg-white/5",           label: "検証中" },
    confirmed: { icon: "✅", cls: "border-emerald-500/30 bg-emerald-500/10", label: "確認済" },
    rejected:  { icon: "❌", cls: "border-red-500/30 bg-red-500/10",        label: "否定" },
    adjusted:  { icon: "🔧", cls: "border-blue-500/30 bg-blue-500/10",      label: "調整済" },
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
        </div>
      </div>
    </div>
  );
}

function TypeWeightBar({ weights }: { weights: Record<string, number> }) {
  const data = Object.entries(weights).map(([type, weight]) => ({
    type: typeLabel(type),
    weight: Math.round(weight * 100) / 100,
    raw: type,
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
          labelStyle={{ color: "rgba(255,255,255,0.8)" }}
          formatter={(v: number) => [v.toFixed(2), "重み"]}
        />
        <Bar dataKey="weight" radius={[4, 4, 0, 0]}>
          {data.map((d) => (
            <Cell key={d.raw} fill={colors[d.raw] ?? "#6b7280"} fillOpacity={0.85} />
          ))}
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
    .map((p) => ({
      date: fmtDate(p.postedAt).slice(0, 5),
      score: calcScore(p.metrics),
      type: p.type,
    }));

  if (data.length === 0) return (
    <div className="flex items-center justify-center h-28 text-xs text-white/30">
      データ蓄積中...
    </div>
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

// ─── メインダッシュボード ─────────────────────────────────────────────────────

function Dashboard() {
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<"overview" | "strategy" | "posts" | "patterns">("overview");

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

  const posts = postsData?.posts ?? [];
  const stats = status?.stats;
  const postsWithMetrics = posts.filter((p) => p.metrics);
  const totalScore = postsWithMetrics.reduce((s, p) => s + calcScore(p.metrics), 0);
  const avgScore = postsWithMetrics.length > 0 ? (totalScore / postsWithMetrics.length).toFixed(1) : "—";

  const TABS = [
    { id: "overview", label: "概要" },
    { id: "strategy", label: "🧠 戦略エンジン" },
    { id: "posts", label: "投稿履歴" },
    { id: "patterns", label: "外部データ" },
  ] as const;

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
        <div className="max-w-5xl mx-auto px-4 flex gap-0 border-t border-white/8">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
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
        {/* ── 概要タブ ── */}
        {tab === "overview" && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="総投稿数" value={stats?.totalPosts ?? "—"} sub="全期間" />
              <StatCard label="今週の投稿" value={stats?.postsLast7Days ?? "—"} sub="過去7日間" />
              <StatCard label="累計いいね" value={(stats?.totalLikes ?? 0).toLocaleString()} accent="text-rose-400" />
              <StatCard label="平均エンゲージメント" value={avgScore} sub="スコア / 投稿" accent="text-indigo-400" />
            </div>

            {/* Engagement trend */}
            <div className="rounded-xl border border-white/8 bg-white/5 p-4">
              <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">エンゲージメント推移</h2>
              <EngagementChart posts={posts} />
            </div>

            {/* Schedule + Last post */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-white/8 bg-white/5 p-4">
                <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">投稿スケジュール</h2>
                <div className="space-y-1.5">
                  {[
                    { time: "09:00", type: "amateur", label: "素人系" },
                    { time: "12:00", type: "buzz",    label: "高評価" },
                    { time: "18:00", type: "buzz",    label: "バズ + 指標更新" },
                    { time: "20:00", type: "celebrity", label: "芸能人似 (動的)" },
                    { time: "21:00", type: "random",  label: "ランダム" },
                    { time: "23:00", type: "sale",    label: "セール" },
                  ].map((s) => (
                    <div key={s.time} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
                      <span className="text-xs font-mono text-indigo-300">{s.time} JST</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${typeBadge(s.type)}`}>{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-white/8 bg-white/5 p-4">
                <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">最新投稿</h2>
                {stats?.lastPostedAt ? (
                  <div className="space-y-3">
                    <div>
                      <p className="text-[10px] text-white/40 mb-0.5">投稿日時</p>
                      <p className="text-sm font-medium">{fmtDate(stats.lastPostedAt)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-white/40 mb-0.5">作品タイトル</p>
                      <p className="text-xs text-white/70 line-clamp-3">{stats.lastPostTitle}</p>
                    </div>
                    <a
                      href={`https://twitter.com/${(status?.account ?? "").replace("@", "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
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
          </>
        )}

        {/* ── 戦略エンジンタブ ── */}
        {tab === "strategy" && strategy && (
          <>
            {/* 主要パラメータ */}
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
                <span className="text-[10px] text-white/30">高いほど多く投稿</span>
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
              <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">
                仮説検証ステータス ({strategy.hypotheses.length}件)
              </h2>
              <div className="space-y-2">
                {strategy.hypotheses.length === 0 ? (
                  <p className="text-xs text-white/30 text-center py-4">まだ仮説がありません。最初のサイクル後に表示されます。</p>
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
                          <li key={j} className="text-xs text-white/70 flex gap-1.5">
                            <span className="text-white/30">→</span>{dec}
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

        {/* ── 投稿履歴タブ ── */}
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
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${typeBadge(post.type)}`}>
                            {typeLabel(post.type)}
                          </span>
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
                        target="_blank"
                        rel="noopener noreferrer"
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

        {/* ── 外部データタブ ── */}
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
                          target="_blank"
                          rel="noopener noreferrer"
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
