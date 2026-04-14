import { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQuery, useMutation } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  ResponsiveContainer, LineChart, Line, Cell, PieChart, Pie,
} from "recharts";

const queryClient = new QueryClient();
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = "";

interface SafetyStatus {
  automationLevel: "MANUAL_ONLY" | "SEMI_AUTO" | "FULL_AUTO";
  riskScore: number;
  dailyPostLimit: number;
  todayPostCount: number;
  todayAffiliateCount: number;
  todayNonAffiliateCount: number;
  todayFollowCount: number;
  consecutiveAffiliateCount: number;
  followerCount: number;
  accountAgeDays: number;
  accountWeek: number;
  currentAffiliateRatio: number;
  remainingPostsToday: number;
  remainingFollowsToday: number;
  totalPosts: number;
  totalAffiliatePosts: number;
  lastPostAt: string | null;
  riskHistory: { date: string; score: number }[];
  config: {
    manualOnlyDays: number;
    semiAutoMinFollowers: number;
    fullAutoMinFollowers: number;
    maxDailyFollows: number;
    maxAffiliateRatioPct: number;
    maxConsecutiveAffiliate: number;
  };
  automationRequirements: {
    semiAuto: { minFollowers: number; minAccountAgeDays: number; followersMet: boolean; ageMet: boolean };
    fullAuto: { minFollowers: number; followersMet: boolean };
  };
}

interface BotStatus {
  status: string;
  uptime: number;
  account: string;
  mode: string;
  safety: {
    level: string;
    riskScore: number;
    dailyPostLimit: number;
    todayPostCount: number;
    remainingPostsToday: number;
    affiliateRatio: number;
    followerCount: number;
    accountAgeDays: number;
  };
  stats: {
    totalPosts: number;
    postsLast7Days: number;
    lastPostedAt: string | null;
    lastPostTitle: string | null;
    totalLikes: number;
    totalRetweets: number;
  };
}

interface Post {
  tweetId: string;
  type: string;
  contentType?: string;
  text: string;
  item?: { id: string; title: string; affiliateURL: string };
  postedAt: string;
  metrics: { like_count: number; retweet_count: number; impression_count?: number; reply_count?: number; bookmark_count?: number } | null;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", hour12: false,
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function formatUptime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function typeLabel(t: string) {
  const m: Record<string, string> = {
    amateur: "素人", rank: "ランキング", sale: "セール", buzz: "バズ",
    random: "ランダム", engagement: "エンゲージ", fanza: "FANZA",
    myfans: "MyFans", impression: "インプ狙い", emergency: "緊急",
    manual: "手動", "meeting-post": "AI会議",
  };
  return m[t] ?? t;
}

function riskColor(score: number): string {
  if (score >= 60) return "#ef4444";
  if (score >= 30) return "#f59e0b";
  return "#22c55e";
}

function riskLabel(score: number): string {
  if (score >= 60) return "危険";
  if (score >= 30) return "注意";
  return "安全";
}

function levelLabel(level: string): string {
  if (level === "FULL_AUTO") return "完全自動";
  if (level === "SEMI_AUTO") return "半自動";
  return "手動のみ";
}

function levelColor(level: string): string {
  if (level === "FULL_AUTO") return "#22c55e";
  if (level === "SEMI_AUTO") return "#3b82f6";
  return "#f59e0b";
}

type Tab = "home" | "posts" | "analytics" | "scorer" | "settings";

function Dashboard() {
  const [tab, setTab] = useState<Tab>("home");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const { data: status } = useQuery<BotStatus>({
    queryKey: ["botStatus", tick],
    queryFn: () => fetch(`${API}/api/bot/status`).then((r) => r.json()),
    refetchInterval: 30000,
  });

  const { data: postsData, refetch: refetchPosts } = useQuery<{ posts: Post[] }>({
    queryKey: ["botPosts", tick],
    queryFn: () => fetch(`${API}/api/bot/posts`).then((r) => r.json()),
    refetchInterval: 60000,
  });

  const { data: safetyData, refetch: refetchSafety } = useQuery<SafetyStatus>({
    queryKey: ["safety", tick],
    queryFn: () => fetch(`${API}/api/safety/status`).then((r) => r.json()),
    refetchInterval: 30000,
  });

  const { data: rebrandlyData, refetch: refetchRebrandly } = useQuery<{
    links: Array<{ id: string; slashtag: string; destination: string; title: string; clicks: number }>;
    lastSyncedAt: string | null;
  }>({
    queryKey: ["rebrandly"],
    queryFn: () => fetch(`${API}/api/bot/rebrandly`).then((r) => r.json()),
    refetchInterval: 600000,
  });

  const posts = postsData?.posts ?? [];
  const stats = status?.stats;
  const safety = safetyData;

  const totalClicks = rebrandlyData?.links?.reduce((s, l) => s + l.clicks, 0) ?? 0;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white pb-20">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-[#0a0a0f]/95 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-[15px] font-bold tracking-tight">MyFans×FANZA Bot</h1>
            <p className="text-[11px] text-zinc-500">
              {status ? `@${status.account} · ${formatUptime(status.uptime)}` : "接続中..."}
            </p>
          </div>
          {safety && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: riskColor(safety.riskScore) }} />
              <span className="text-[11px] font-semibold" style={{ color: riskColor(safety.riskScore) }}>
                {riskLabel(safety.riskScore)} {safety.riskScore}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4">
        {/* ── ホーム ── */}
        {tab === "home" && (
          <div className="space-y-4">
            {/* Safety Status Card */}
            {safety && (
              <div className="rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-800 border border-white/5 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">安全レベル</p>
                    <p className="text-[20px] font-bold mt-0.5" style={{ color: levelColor(safety.automationLevel) }}>
                      {levelLabel(safety.automationLevel)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-zinc-500">アカウント</p>
                    <p className="text-[14px] font-semibold text-white">{safety.accountAgeDays}日目</p>
                  </div>
                </div>

                {/* Risk Score Bar */}
                <div className="mb-4">
                  <div className="flex justify-between mb-1">
                    <span className="text-[10px] text-zinc-500">リスクスコア</span>
                    <span className="text-[12px] font-bold" style={{ color: riskColor(safety.riskScore) }}>
                      {safety.riskScore}/100
                    </span>
                  </div>
                  <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{
                      width: `${safety.riskScore}%`,
                      backgroundColor: riskColor(safety.riskScore),
                    }} />
                  </div>
                </div>

                {/* Quick Stats Grid */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-black/30 rounded-xl p-3 text-center">
                    <p className="text-[18px] font-bold text-white">{safety.remainingPostsToday}</p>
                    <p className="text-[10px] text-zinc-500">残り投稿</p>
                  </div>
                  <div className="bg-black/30 rounded-xl p-3 text-center">
                    <p className="text-[18px] font-bold text-blue-400">{safety.currentAffiliateRatio}%</p>
                    <p className="text-[10px] text-zinc-500">アフィリ比率</p>
                  </div>
                  <div className="bg-black/30 rounded-xl p-3 text-center">
                    <p className="text-[18px] font-bold text-purple-400">{safety.followerCount}</p>
                    <p className="text-[10px] text-zinc-500">フォロワー</p>
                  </div>
                </div>
              </div>
            )}

            {/* KPI Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">総投稿</p>
                <p className="text-[24px] font-bold">{stats?.totalPosts ?? "—"}</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">直近7日: {stats?.postsLast7Days ?? 0}件</p>
              </div>
              <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">クリック</p>
                <p className="text-[24px] font-bold text-blue-400">{totalClicks}</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">Rebrandly計測</p>
              </div>
              <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">いいね</p>
                <p className="text-[24px] font-bold text-rose-400">{stats?.totalLikes ?? "—"}</p>
              </div>
              <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">RT</p>
                <p className="text-[24px] font-bold text-emerald-400">{stats?.totalRetweets ?? "—"}</p>
              </div>
            </div>

            {/* Schedule */}
            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-5">
              <p className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">投稿スケジュール</p>
              <div className="space-y-2">
                {[
                  { time: "10:30", label: "エンゲージメント①", ratio: "70% エンゲージ" },
                  { time: "17:00", label: "混合スロット②", ratio: "20% FANZA / 10% MyFans" },
                  { time: "20:00", label: "プライムタイム③", ratio: "動的配分" },
                ].map((s) => (
                  <div key={s.time} className="flex items-center gap-3 bg-black/30 rounded-xl px-4 py-3">
                    <span className="text-[14px] font-mono font-bold text-white w-12">{s.time}</span>
                    <div className="flex-1">
                      <p className="text-[12px] font-medium text-white">{s.label}</p>
                      <p className="text-[10px] text-zinc-500">{s.ratio}</p>
                    </div>
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  </div>
                ))}
              </div>
            </div>

            {/* Last Post */}
            {stats?.lastPostedAt && (
              <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
                <p className="text-[10px] text-zinc-500 mb-1">最終投稿</p>
                <p className="text-[12px] text-white">{fmtDate(stats.lastPostedAt)}</p>
                {stats.lastPostTitle && <p className="text-[11px] text-zinc-400 mt-1 truncate">{stats.lastPostTitle}</p>}
              </div>
            )}
          </div>
        )}

        {/* ── 投稿 ── */}
        {tab === "posts" && (
          <div className="space-y-4">
            {/* Quick Actions */}
            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
              <p className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">クイックアクション</p>
              <div className="grid grid-cols-2 gap-2">
                <QuickActionButton label="TL同期" icon="🔄"
                  action={() => fetch(`${API}/api/bot/posts/sync-timeline`, { method: "POST" }).then(() => refetchPosts())} />
                <QuickActionButton label="Rebrandly同期" icon="🔗"
                  action={() => fetch(`${API}/api/bot/rebrandly/sync`, { method: "POST" }).then(() => refetchRebrandly())} />
                <QuickActionButton label="スナップショット" icon="📷"
                  action={() => fetch(`${API}/api/bot/snapshots/capture`, { method: "POST" }).then(() => refetchSafety())} />
                <QuickActionButton label="指標更新" icon="📊"
                  action={() => fetch(`${API}/api/trigger/metrics`, { method: "POST", headers: { "x-trigger-secret": "fanza-bot-trigger" } })} />
              </div>
            </div>

            {/* Post Safety Check */}
            {safety && (
              <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[12px] font-semibold text-zinc-400">投稿可否チェック</p>
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: safety.remainingPostsToday > 0 ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: safety.remainingPostsToday > 0 ? "#22c55e" : "#ef4444" }}>
                    {safety.remainingPostsToday > 0 ? `残り${safety.remainingPostsToday}件OK` : "本日上限"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-black/30 rounded-lg p-2">
                    <p className="text-[14px] font-bold">{safety.todayPostCount}/{safety.dailyPostLimit}</p>
                    <p className="text-[9px] text-zinc-500">本日投稿</p>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2">
                    <p className="text-[14px] font-bold">{safety.todayAffiliateCount}</p>
                    <p className="text-[9px] text-zinc-500">アフィリ</p>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2">
                    <p className="text-[14px] font-bold">{safety.consecutiveAffiliateCount}</p>
                    <p className="text-[9px] text-zinc-500">連続アフィリ</p>
                  </div>
                </div>
              </div>
            )}

            {/* Post List */}
            <div className="rounded-2xl bg-zinc-900 border border-white/5 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/5">
                <p className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider">投稿履歴</p>
              </div>
              <div className="divide-y divide-white/5 max-h-[60vh] overflow-y-auto">
                {posts.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <p className="text-zinc-500 text-[12px]">投稿データなし</p>
                  </div>
                ) : posts.map((p) => (
                  <div key={p.tweetId} className="px-4 py-3">
                    <div className="flex items-start gap-2 mb-1">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${typePillDark(p.type)}`}>
                        {typeLabel(p.type)}
                      </span>
                      <span className="text-[10px] text-zinc-500 ml-auto shrink-0">{fmtDate(p.postedAt)}</span>
                    </div>
                    <p className="text-[11px] text-zinc-300 leading-relaxed line-clamp-2 mt-1">{p.text}</p>
                    {p.metrics && (
                      <div className="flex items-center gap-3 mt-2">
                        {p.metrics.impression_count != null && (
                          <span className="text-[10px] text-zinc-500">👁 {p.metrics.impression_count}</span>
                        )}
                        <span className="text-[10px] text-zinc-500">❤️ {p.metrics.like_count}</span>
                        <span className="text-[10px] text-zinc-500">🔁 {p.metrics.retweet_count}</span>
                        <a href={`https://twitter.com/i/web/status/${p.tweetId}`} target="_blank" rel="noopener noreferrer"
                          className="ml-auto text-[10px] text-blue-400">開く →</a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── 分析 ── */}
        {tab === "analytics" && (
          <div className="space-y-4">
            {/* Revenue Split */}
            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-5">
              <p className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">収益構成（目標）</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="bg-blue-500/10 rounded-xl p-3 text-center border border-blue-500/20">
                  <p className="text-[20px] font-bold text-blue-400">¥30,000</p>
                  <p className="text-[10px] text-zinc-500">FANZA目標/月</p>
                </div>
                <div className="bg-pink-500/10 rounded-xl p-3 text-center border border-pink-500/20">
                  <p className="text-[20px] font-bold text-pink-400">¥24,000</p>
                  <p className="text-[10px] text-zinc-500">MyFans目標/月</p>
                  <p className="text-[9px] text-zinc-600">¥3,000×8件</p>
                </div>
              </div>
              <div className="bg-emerald-500/10 rounded-xl p-3 text-center border border-emerald-500/20">
                <p className="text-[24px] font-bold text-emerald-400">¥54,000</p>
                <p className="text-[10px] text-zinc-500">月間目標（3ヶ月目）</p>
              </div>
            </div>

            {/* Content Ratio */}
            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-5">
              <p className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">コンテンツ比率</p>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={[
                    { name: "エンゲージメント", value: 70, fill: "#3b82f6" },
                    { name: "FANZA", value: 20, fill: "#f59e0b" },
                    { name: "MyFans", value: 10, fill: "#ec4899" },
                  ]} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={3} />
                  <RechartTooltip contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 11, color: "#fff" }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 mt-2">
                {[
                  { label: "エンゲージ", color: "#3b82f6", pct: "70%" },
                  { label: "FANZA", color: "#f59e0b", pct: "20%" },
                  { label: "MyFans", color: "#ec4899", pct: "10%" },
                ].map((l) => (
                  <div key={l.label} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
                    <span className="text-[10px] text-zinc-400">{l.label} {l.pct}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Risk History */}
            {safety && safety.riskHistory.length > 0 && (
              <div className="rounded-2xl bg-zinc-900 border border-white/5 p-5">
                <p className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">リスク推移</p>
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={safety.riskHistory.slice(-14)} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#71717a" }} tickFormatter={(v) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 9, fill: "#71717a" }} domain={[0, 100]} />
                    <RechartTooltip contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 11, color: "#fff" }} />
                    <Line type="monotone" dataKey="score" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b", r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Rebrandly Links */}
            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider">クリック計測</p>
                <span className="text-[20px] font-bold text-blue-400">{totalClicks}</span>
              </div>
              {rebrandlyData?.links && rebrandlyData.links.length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {[...rebrandlyData.links].sort((a, b) => b.clicks - a.clicks).slice(0, 10).map((link) => {
                    const max = Math.max(...rebrandlyData.links.map((l) => l.clicks), 1);
                    return (
                      <div key={link.id} className="bg-black/30 rounded-lg p-2.5">
                        <div className="flex justify-between mb-1">
                          <p className="text-[11px] text-zinc-300 truncate flex-1">{link.title || link.slashtag}</p>
                          <span className="text-[12px] font-bold text-blue-400 ml-2">{link.clicks}</span>
                        </div>
                        <div className="h-1 bg-zinc-700 rounded-full">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(link.clicks / max) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-zinc-500 text-center py-4">データなし</p>
              )}
            </div>

            {/* Engagement Chart */}
            {posts.filter(p => p.metrics).length > 0 && (
              <div className="rounded-2xl bg-zinc-900 border border-white/5 p-5">
                <p className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">エンゲージメント推移</p>
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart
                    data={posts.filter(p => p.metrics).sort((a, b) => new Date(a.postedAt).getTime() - new Date(b.postedAt).getTime()).slice(-20).map(p => ({
                      date: fmtDate(p.postedAt).slice(0, 5),
                      score: (p.metrics!.like_count ?? 0) + (p.metrics!.retweet_count ?? 0) * 3,
                    }))}
                    margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#71717a" }} />
                    <YAxis tick={{ fontSize: 9, fill: "#71717a" }} />
                    <RechartTooltip contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 11, color: "#fff" }} />
                    <Line type="monotone" dataKey="score" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: "#8b5cf6", r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ── 画像採点 ── */}
        {tab === "scorer" && <ImageScorerTab />}

        {/* ── 設定 ── */}
        {tab === "settings" && (
          <div className="space-y-4">
            {/* Safety Rules */}
            {safety && (
              <>
                <div className="rounded-2xl bg-zinc-900 border border-white/5 p-5">
                  <p className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider mb-4">凍結回避ルール</p>
                  <div className="space-y-3">
                    <SettingRow label="手動専用期間" value={`${safety.config.manualOnlyDays}日`} sub={`現在${safety.accountAgeDays}日目`} />
                    <SettingRow label="半自動 解禁条件" value={`${safety.config.semiAutoMinFollowers}フォロワー`}
                      sub={safety.automationRequirements.semiAuto.followersMet ? "✅ 達成" : `残り${safety.config.semiAutoMinFollowers - safety.followerCount}人`} />
                    <SettingRow label="完全自動 解禁条件" value={`${safety.config.fullAutoMinFollowers}フォロワー`}
                      sub={safety.automationRequirements.fullAuto.followersMet ? "✅ 達成" : `残り${safety.config.fullAutoMinFollowers - safety.followerCount}人`} />
                    <SettingRow label="アフィリ比率上限" value={`${safety.config.maxAffiliateRatioPct}%`}
                      sub={`現在 ${safety.currentAffiliateRatio}%`} />
                    <SettingRow label="連続アフィリ上限" value={`${safety.config.maxConsecutiveAffiliate}件`}
                      sub={`現在 ${safety.consecutiveAffiliateCount}件連続`} />
                    <SettingRow label="1日フォロー上限" value={`${safety.config.maxDailyFollows}件`}
                      sub={`本日 ${safety.todayFollowCount}件`} />
                  </div>
                </div>

                {/* Post Limit Progression */}
                <div className="rounded-2xl bg-zinc-900 border border-white/5 p-5">
                  <p className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">投稿上限 段階制</p>
                  <div className="text-[11px] text-zinc-400 space-y-1.5">
                    {[
                      { week: "W1-2", limit: 3 },
                      { week: "W3-4", limit: 5 },
                      { week: "W5-6", limit: 8 },
                      { week: "W7-8", limit: 10 },
                      { week: "W9-12", limit: 12 },
                    ].map((w) => (
                      <div key={w.week} className={`flex items-center justify-between px-3 py-2 rounded-lg ${safety.accountWeek >= parseInt(w.week.replace('W', '')) ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-black/20'}`}>
                        <span>{w.week}</span>
                        <span className="font-bold text-white">{w.limit}件/日</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Automation Progress */}
                <div className="rounded-2xl bg-zinc-900 border border-white/5 p-5">
                  <p className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider mb-4">自動化解禁ロードマップ</p>
                  <div className="space-y-3">
                    <ProgressStep
                      label="手動のみ"
                      sub={`最初${safety.config.manualOnlyDays}日間`}
                      active={safety.automationLevel === "MANUAL_ONLY"}
                      done={safety.accountAgeDays >= safety.config.manualOnlyDays}
                    />
                    <ProgressStep
                      label="半自動"
                      sub={`${safety.config.semiAutoMinFollowers}フォロワー達成後`}
                      active={safety.automationLevel === "SEMI_AUTO"}
                      done={safety.followerCount >= safety.config.semiAutoMinFollowers}
                    />
                    <ProgressStep
                      label="完全自動"
                      sub={`${safety.config.fullAutoMinFollowers}フォロワー達成後`}
                      active={safety.automationLevel === "FULL_AUTO"}
                      done={safety.followerCount >= safety.config.fullAutoMinFollowers}
                    />
                  </div>
                </div>
              </>
            )}

            {/* Monthly Cost */}
            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-5">
              <p className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">月額コスト</p>
              <div className="space-y-2">
                {[
                  { name: "Replit", cost: "¥3,000" },
                  { name: "Twitter API Basic", cost: "¥15,000" },
                  { name: "Rebrandly", cost: "¥4,350" },
                  { name: "Canva Pro", cost: "¥1,949" },
                  { name: "OpenAI API", cost: "¥1,500" },
                ].map((c) => (
                  <div key={c.name} className="flex justify-between text-[11px] px-3 py-2 bg-black/20 rounded-lg">
                    <span className="text-zinc-400">{c.name}</span>
                    <span className="text-white font-medium">{c.cost}</span>
                  </div>
                ))}
                <div className="flex justify-between text-[13px] px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg font-bold">
                  <span className="text-amber-400">合計</span>
                  <span className="text-amber-400">¥25,799</span>
                </div>
              </div>
            </div>

            {/* Bot Control */}
            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-5">
              <p className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">ボット制御</p>
              <div className="grid grid-cols-2 gap-2">
                <QuickActionButton label="緊急停止" icon="🛑"
                  action={() => fetch(`${API}/api/trigger/pause`, { method: "POST", headers: { "x-trigger-secret": "fanza-bot-trigger" } })}
                  variant="danger" />
                <QuickActionButton label="再開" icon="▶️"
                  action={() => fetch(`${API}/api/trigger/resume`, { method: "POST", headers: { "x-trigger-secret": "fanza-bot-trigger" } })} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Tab Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#0a0a0f]/95 backdrop-blur-xl border-t border-white/5 safe-area-inset-bottom z-50">
        <div className="max-w-lg mx-auto flex">
          {([
            { key: "home", label: "ホーム", icon: "🏠" },
            { key: "posts", label: "投稿", icon: "📝" },
            { key: "analytics", label: "分析", icon: "📊" },
            { key: "scorer", label: "採点", icon: "🏆" },
            { key: "settings", label: "設定", icon: "⚙️" },
          ] as const).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 py-3 flex flex-col items-center gap-0.5 transition-colors ${tab === key ? "text-blue-400" : "text-zinc-600"}`}
            >
              <span className="text-[18px]">{icon}</span>
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function typePillDark(t: string): string {
  const m: Record<string, string> = {
    amateur: "bg-rose-500/10 text-rose-400",
    rank: "bg-amber-500/10 text-amber-400",
    sale: "bg-emerald-500/10 text-emerald-400",
    buzz: "bg-pink-500/10 text-pink-400",
    random: "bg-purple-500/10 text-purple-400",
    engagement: "bg-blue-500/10 text-blue-400",
    fanza: "bg-amber-500/10 text-amber-400",
    myfans: "bg-pink-500/10 text-pink-400",
    impression: "bg-sky-500/10 text-sky-400",
    emergency: "bg-red-500/10 text-red-400",
    manual: "bg-zinc-500/10 text-zinc-400",
    "meeting-post": "bg-violet-500/10 text-violet-400",
  };
  return m[t] ?? "bg-zinc-500/10 text-zinc-400";
}

function QuickActionButton({ label, icon, action, variant }: { label: string; icon: string; action: () => Promise<any>; variant?: "danger" }) {
  const [loading, setLoading] = useState(false);
  return (
    <button
      onClick={async () => { setLoading(true); try { await action(); } catch {} finally { setLoading(false); } }}
      disabled={loading}
      className={`py-2.5 rounded-xl text-[12px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 transition-all ${
        variant === "danger" ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-white/5 text-zinc-300 border border-white/5 hover:bg-white/10"
      }`}
    >
      <span>{icon}</span>
      {loading ? "処理中..." : label}
    </button>
  );
}

function SettingRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <div>
        <p className="text-[12px] text-zinc-300">{label}</p>
        {sub && <p className="text-[10px] text-zinc-500">{sub}</p>}
      </div>
      <span className="text-[12px] font-semibold text-white">{value}</span>
    </div>
  );
}

function ProgressStep({ label, sub, active, done }: { label: string; sub: string; active: boolean; done: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl ${active ? "bg-blue-500/10 border border-blue-500/20" : done ? "bg-emerald-500/5 border border-emerald-500/10" : "bg-black/20 border border-white/5"}`}>
      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${done ? "bg-emerald-500 text-white" : active ? "bg-blue-500 text-white" : "bg-zinc-700 text-zinc-500"}`}>
        {done ? "✓" : active ? "●" : "○"}
      </div>
      <div>
        <p className={`text-[12px] font-medium ${active ? "text-blue-400" : done ? "text-emerald-400" : "text-zinc-500"}`}>{label}</p>
        <p className="text-[10px] text-zinc-500">{sub}</p>
      </div>
    </div>
  );
}

function ImageScorerTab() {
  const [mode, setMode] = useState<"url" | "prompt">("url");
  const [imageUrl, setImageUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");

  const handleScore = async () => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      let res;
      if (mode === "url") {
        res = await fetch(`${API}/api/bot/image/score`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: imageUrl.trim() }),
        });
      } else {
        res = await fetch(`${API}/api/bot/image/generate-and-score`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: prompt.trim() }),
        });
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
      if (mode === "prompt" && data.imageUrl) setImageUrl(data.imageUrl);
    } catch (e: any) {
      setError(e.message || "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const gradeColor: Record<string, string> = {
    S: "text-amber-400",
    A: "text-emerald-400",
    B: "text-yellow-400",
    C: "text-red-400",
  };

  const scoreBarColor = (score: number) => {
    if (score >= 9) return "bg-amber-400";
    if (score >= 7) return "bg-emerald-400";
    if (score >= 5) return "bg-yellow-400";
    return "bg-red-400";
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-zinc-900 border border-white/5 p-5">
        <p className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">画像スコアリング（橋本環奈 = 100点基準）</p>
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setMode("url")}
            className={`px-3 py-1.5 text-[11px] rounded-lg font-medium transition-colors ${mode === "url" ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "bg-zinc-800 text-zinc-500 border border-white/5"}`}
          >URL採点</button>
          <button
            onClick={() => setMode("prompt")}
            className={`px-3 py-1.5 text-[11px] rounded-lg font-medium transition-colors ${mode === "prompt" ? "bg-pink-500/20 text-pink-400 border border-pink-500/30" : "bg-zinc-800 text-zinc-500 border border-white/5"}`}
          >生成＋採点</button>
        </div>

        {mode === "url" ? (
          <input
            type="text"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="画像URLを貼り付け..."
            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-[12px] text-white placeholder-zinc-600 focus:border-blue-500/50 focus:outline-none"
          />
        ) : (
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="画像生成プロンプトを入力..."
            rows={4}
            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-[12px] text-white placeholder-zinc-600 focus:border-pink-500/50 focus:outline-none resize-none"
          />
        )}

        <button
          onClick={handleScore}
          disabled={loading || (mode === "url" ? !imageUrl.trim() : !prompt.trim())}
          className="mt-3 w-full py-2.5 rounded-lg text-[12px] font-bold transition-all disabled:opacity-40 bg-gradient-to-r from-pink-500 to-blue-500 text-white hover:brightness-110"
        >
          {loading ? (mode === "prompt" ? "生成＋採点中..." : "採点中...") : "🏆 採点する"}
        </button>
      </div>

      {error && (
        <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-4 text-[12px] text-red-400">
          {error}
        </div>
      )}

      {result && (
        <>
          {(result.imageUrl || imageUrl) && (
            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4 flex justify-center">
              <img src={result.imageUrl || imageUrl} alt="scored" className="max-h-[300px] rounded-xl object-contain" />
            </div>
          )}

          <div className="rounded-2xl bg-zinc-900 border border-white/5 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className={`text-[40px] font-black ${gradeColor[result.grade] || "text-white"}`}>{result.totalScore ?? result.score?.totalScore}</span>
                <span className="text-zinc-500 text-[14px] font-medium">/100</span>
              </div>
              <div className="text-right">
                <span className={`text-[24px] font-black ${gradeColor[result.grade ?? result.score?.grade] || "text-white"}`}>{result.grade ?? result.score?.grade}</span>
                <p className="text-[11px] mt-0.5">{(result.passed ?? result.score?.passed) ? <span className="text-emerald-400">✅ 合格</span> : <span className="text-red-400">❌ 不合格</span>}</p>
              </div>
            </div>

            <div className="space-y-2">
              {(result.items ?? result.score?.items ?? []).map((item: any, i: number) => (
                <div key={i} className="bg-black/20 rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-zinc-300 font-medium">{item.category}</span>
                    <span className="text-[12px] font-bold text-white">{item.score}/10</span>
                  </div>
                  <div className="w-full bg-zinc-800 rounded-full h-1.5 mb-1">
                    <div className={`h-1.5 rounded-full ${scoreBarColor(item.score)}`} style={{ width: `${item.score * 10}%` }} />
                  </div>
                  <p className="text-[10px] text-zinc-500">{item.comment}</p>
                </div>
              ))}
            </div>
          </div>

          {(result.summary ?? result.score?.summary) && (
            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
              <p className="text-[11px] font-semibold text-zinc-400 uppercase mb-2">総評</p>
              <p className="text-[12px] text-zinc-300 leading-relaxed">{result.summary ?? result.score?.summary}</p>
            </div>
          )}

          {((result.improvements ?? result.score?.improvements)?.length > 0 || (result.promptFixes ?? result.score?.promptFixes)?.length > 0) && (
            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4 space-y-3">
              {(result.improvements ?? result.score?.improvements)?.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-yellow-400 uppercase mb-1.5">改善ポイント</p>
                  {(result.improvements ?? result.score?.improvements).map((imp: string, i: number) => (
                    <p key={i} className="text-[11px] text-zinc-400 pl-3 border-l-2 border-yellow-500/30 mb-1">• {imp}</p>
                  ))}
                </div>
              )}
              {(result.promptFixes ?? result.score?.promptFixes)?.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-pink-400 uppercase mb-1.5">プロンプト修正案</p>
                  {(result.promptFixes ?? result.score?.promptFixes).map((fix: string, i: number) => (
                    <p key={i} className="text-[11px] text-zinc-400 pl-3 border-l-2 border-pink-500/30 mb-1">• {fix}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const speakerStyle: Record<string, { label: string; bg: string; text: string }> = {
  user: { label: "あなた", bg: "bg-blue-500/20", text: "text-blue-400" },
  gpt: { label: "o3", bg: "bg-emerald-500/10", text: "text-emerald-400" },
  claude: { label: "Claude", bg: "bg-violet-500/10", text: "text-violet-400" },
  grok: { label: "Grok", bg: "bg-amber-500/10", text: "text-amber-400" },
  system: { label: "System", bg: "bg-zinc-800", text: "text-zinc-400" },
};

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <WouterRouter base={BASE}>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route component={NotFound} />
          </Switch>
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
