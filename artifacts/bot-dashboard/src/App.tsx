import { useEffect, useState, useCallback } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import {
  XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  ResponsiveContainer, LineChart, Line, PieChart, Pie,
} from "recharts";

const queryClient = new QueryClient();
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = "";

interface SafetyStatus {
  automationLevel: string;
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
  text: string;
  postedAt: string;
  metrics: { like_count: number; retweet_count: number; impression_count?: number } | null;
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
    manual: "手動", "meeting-post": "AI会議", poll: "Poll",
  };
  return m[t] ?? t;
}
function typePill(t: string): string {
  const m: Record<string, string> = {
    amateur: "bg-rose-500/10 text-rose-400", rank: "bg-amber-500/10 text-amber-400",
    sale: "bg-emerald-500/10 text-emerald-400", buzz: "bg-pink-500/10 text-pink-400",
    engagement: "bg-blue-500/10 text-blue-400", fanza: "bg-amber-500/10 text-amber-400",
    myfans: "bg-pink-500/10 text-pink-400", manual: "bg-zinc-500/10 text-zinc-400",
    "meeting-post": "bg-violet-500/10 text-violet-400", poll: "bg-blue-500/10 text-blue-400",
  };
  return m[t] ?? "bg-zinc-500/10 text-zinc-400";
}


const POLL_TEMPLATES = [
  { time: "10:30", label: "Poll①", template: "みんなはどっち派？🗳️\n\n正直に答えてね💦\n#FANZA" },
  { time: "20:15", label: "Poll②", template: "【エロ投票】どっち派？👉\n\n🗳️ 投票してね！\n#FANZA" },
];
const DAY_THEMES = [
  { day: "月", theme: "ジャンル対決", example: "巨乳 vs 美乳 vs 貧乳" },
  { day: "火", theme: "シチュ対決", example: "不倫 vs 寝取られ" },
  { day: "水", theme: "属性対決", example: "JD vs OL vs 人妻" },
  { day: "木", theme: "プレイ対決", example: "正常位 vs 後背位 vs 騎乗位" },
  { day: "金", theme: "新作予想", example: "今週のFANZA1位は？" },
  { day: "土", theme: "ランキング", example: "歴代最高AV女優は？" },
  { day: "日", theme: "フリー", example: "フォロワーリクエスト" },
];

function getNextPostTime() {
  const now = new Date();
  const jst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const h = jst.getHours(), m = jst.getMinutes();
  const slots = [
    { h: 10, m: 30, label: "Poll① 10:30" },
    { h: 20, m: 15, label: "Poll② 20:15" },
  ];
  for (const s of slots) {
    if (h < s.h || (h === s.h && m < s.m)) {
      const target = new Date(jst); target.setHours(s.h, s.m, 0, 0);
      return { label: s.label, ms: target.getTime() - jst.getTime() };
    }
  }
  const tomorrow = new Date(jst); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(10, 30, 0, 0);
  return { label: "Poll① 10:30（明日）", ms: tomorrow.getTime() - jst.getTime() };
}

function formatCountdown(ms: number) {
  if (ms <= 0) return "投稿時間です！";
  const t = Math.floor(ms / 60000), h = Math.floor(t / 60), m = t % 60;
  return h > 0 ? `${h}時間${m}分` : `${m}分`;
}

type Tab = "poll" | "senpai" | "studio" | "data";

function Dashboard() {
  const [tab, setTab] = useState<Tab>("poll");
  const [tick, setTick] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 30000); return () => clearInterval(id); }, []);

  const { data: status } = useQuery<BotStatus>({
    queryKey: ["botStatus", tick],
    queryFn: () => fetch(`${API}/api/bot/status`).then(r => r.json()),
    refetchInterval: 30000,
  });
  const { data: postsData, refetch: refetchPosts } = useQuery<{ posts: Post[] }>({
    queryKey: ["botPosts", tick],
    queryFn: () => fetch(`${API}/api/bot/posts`).then(r => r.json()),
    refetchInterval: 60000,
  });
  const { data: safetyData, refetch: refetchSafety } = useQuery<SafetyStatus>({
    queryKey: ["safety", tick],
    queryFn: () => fetch(`${API}/api/safety/status`).then(r => r.json()),
    refetchInterval: 30000,
  });
  const { data: rebrandlyData, refetch: refetchRebrandly } = useQuery<{
    links: Array<{ id: string; slashtag: string; destination: string; title: string; clicks: number }>;
    lastSyncedAt: string | null;
  }>({
    queryKey: ["rebrandly"],
    queryFn: () => fetch(`${API}/api/bot/rebrandly`).then(r => r.json()),
    refetchInterval: 600000,
  });

  const riskScore = safetyData?.riskScore ?? 0;
  const posts = postsData?.posts ?? [];
  const safety = safetyData;
  const stats = status?.stats;
  const totalClicks = rebrandlyData?.links?.reduce((s, l) => s + l.clicks, 0) ?? 0;

  const [countdown, setCountdown] = useState(getNextPostTime().ms);
  useEffect(() => { const id = setInterval(() => setCountdown(getNextPostTime().ms), 1000); return () => clearInterval(id); }, []);

  const copyTpl = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => { setCopied(label); setTimeout(() => setCopied(null), 2000); });
  }, []);

  const jst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const todayTheme = DAY_THEMES[(jst.getDay() + 6) % 7];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white pb-20">
      <div className="sticky top-0 z-50 bg-[#0a0a0f]/95 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-[15px] font-bold tracking-tight">FANZA Bot</h1>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: riskScore <= 30 ? "#22c55e" : riskScore <= 60 ? "#f59e0b" : "#ef4444" }} />
            <span className="text-[11px] font-semibold" style={{ color: riskScore <= 30 ? "#22c55e" : riskScore <= 60 ? "#f59e0b" : "#ef4444" }}>
              Risk {riskScore} {riskScore <= 30 ? "正常" : riskScore <= 60 ? "注意" : "危険"}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4">

        {tab === "poll" && (
          <div className="space-y-4">
            <SectionHeader icon="🗳️" title="@fanza_poll_lab" sub="メイン — 手動投稿（Xアプリから）" color="text-blue-400" />

            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">次回投稿</p>
                <span className="text-[11px] text-zinc-400">{getNextPostTime().label}</span>
              </div>
              <p className="text-[36px] font-black text-white text-center tracking-tight">{formatCountdown(countdown)}</p>
              <p className="text-[11px] text-zinc-500 text-center mt-1">
                今日: <span className="text-blue-400 font-medium">{todayTheme.day}曜 — {todayTheme.theme}</span>
                <span className="text-zinc-600 ml-1">（{todayTheme.example}）</span>
              </p>
            </div>

            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-2">投稿前チェック</p>
              <div className="space-y-1.5">
                <Check label="リスクスコア正常" ok={riskScore <= 30} />
                <Check label="前回投稿から9時間30分以上経過" ok />
                <Check label="センシティブメディア設定 ON" ok />
                <Check label="ハッシュタグ: #FANZA のみ（1個）" ok />
                <Check label="投稿にリンク・画像を含めない" ok />
              </div>
            </div>

            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-2">テンプレート（タップでコピー）</p>
              {POLL_TEMPLATES.map(t => (
                <div key={t.time} className="bg-black/30 rounded-xl p-3 mb-2 last:mb-0 flex items-start gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">{t.time}</span>
                      <span className="text-[11px] text-zinc-400">{t.label}</span>
                    </div>
                    <pre className="text-[11px] text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed">{t.template}</pre>
                  </div>
                  <button onClick={() => copyTpl(t.template, t.time)}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-all">
                    {copied === t.time ? "✅" : "コピー"}
                  </button>
                </div>
              ))}
            </div>

            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-2">曜日テーマ一覧</p>
              <div className="grid grid-cols-7 gap-1">
                {DAY_THEMES.map((d, i) => (
                  <div key={d.day} className={`text-center py-2 rounded-lg ${(jst.getDay() + 6) % 7 === i ? "bg-blue-500/20 border border-blue-500/30" : "bg-black/20"}`}>
                    <p className="text-[11px] font-bold text-white">{d.day}</p>
                    <p className="text-[8px] text-zinc-500 mt-0.5">{d.theme.slice(0, 4)}</p>
                  </div>
                ))}
              </div>
            </div>

            <InfoCard icon="📌" text="このアカウントはXアプリから手動で投稿します。上のテンプレートをコピーして貼り付けてください。" />
          </div>
        )}

        {tab === "senpai" && (
          <div className="space-y-4">
            <SectionHeader icon="💎" title="@ero_senpai1" sub="サブ — API接続済み（青バッジ）" color="text-purple-400" />

            <div className="rounded-2xl border p-5" style={{
              backgroundColor: riskScore <= 30 ? "rgba(34,197,94,0.05)" : riskScore <= 60 ? "rgba(245,158,11,0.05)" : "rgba(239,68,68,0.05)",
              borderColor: riskScore <= 30 ? "rgba(34,197,94,0.2)" : riskScore <= 60 ? "rgba(245,158,11,0.2)" : "rgba(239,68,68,0.2)",
            }}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">安全レベル</p>
                <QuickBtn label="計測" icon="🔍" action={async () => { await fetch(`${API}/api/bot/snapshots/capture`, { method: "POST" }); refetchSafety(); }} />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[32px]">{riskScore <= 30 ? "🟢" : riskScore <= 60 ? "🟡" : "🔴"}</span>
                <div>
                  <p className="text-[22px] font-black" style={{ color: riskScore <= 30 ? "#22c55e" : riskScore <= 60 ? "#f59e0b" : "#ef4444" }}>
                    Risk {riskScore}
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    {riskScore <= 30 ? "正常 — 投稿可能" : riskScore <= 60 ? "注意 — 投稿は控えめに" : "危険 — 全活動停止推奨"}
                  </p>
                </div>
              </div>
              {safety && (
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <MiniStat label="フォロワー" value={safety.followerCount.toString()} />
                  <MiniStat label="残り投稿" value={safety.remainingPostsToday.toString()} />
                  <MiniStat label="フォロー" value={`${safety.todayFollowCount}/${safety.config.maxDailyFollows}`} />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <KPICard label="総インプ" value={posts.reduce((s, p) => s + (p.metrics?.impression_count ?? 0), 0).toLocaleString()} color="text-white" />
              <KPICard label="クリック" value={totalClicks.toString()} color="text-blue-400" />
              <KPICard label="いいね" value={(stats?.totalLikes ?? 0).toString()} color="text-rose-400" />
              <KPICard label="RT" value={(stats?.totalRetweets ?? 0).toString()} color="text-emerald-400" />
            </div>

            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">操作</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <ActionBtn label="TL同期" icon="🔄" action={async () => { await fetch(`${API}/api/bot/posts/sync-timeline`, { method: "POST" }); refetchPosts(); }} />
                <ActionBtn label="リンク同期" icon="🔗" action={async () => { await fetch(`${API}/api/bot/rebrandly/sync`, { method: "POST" }); refetchRebrandly(); }} />
                <ActionBtn label="指標更新" icon="📊" action={async () => { await fetch(`${API}/api/trigger/metrics`, { method: "POST" }); refetchSafety(); }} />
                <ActionBtn label="スナップショット" icon="📷" action={async () => { await fetch(`${API}/api/bot/snapshots/capture`, { method: "POST" }); refetchSafety(); }} />
              </div>
            </div>

            {safety && (
              <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-3">凍結回避ルール</p>
                <div className="space-y-2">
                  <Rule label="投稿上限/日" value={`${safety.dailyPostLimit}件`} sub={`本日 ${safety.todayPostCount}件`} />
                  <Rule label="アフィリ比率上限" value={`${safety.config.maxAffiliateRatioPct}%`} sub={`現在 ${safety.currentAffiliateRatio}%`} />
                  <Rule label="連続アフィリ上限" value={`${safety.config.maxConsecutiveAffiliate}件`} sub={`現在 ${safety.consecutiveAffiliateCount}件`} />
                  <Rule label="1日フォロー上限" value={`${safety.config.maxDailyFollows}件`} sub={`本日 ${safety.todayFollowCount}件`} />
                </div>
              </div>
            )}

            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">ボット制御</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <ActionBtn label="緊急停止" icon="🛑" variant="danger" action={() => fetch(`${API}/api/trigger/pause`, { method: "POST", headers: { "Content-Type": "application/json" } })} />
                <ActionBtn label="再開" icon="▶️" action={() => fetch(`${API}/api/trigger/resume`, { method: "POST" })} />
              </div>
            </div>

            <InfoCard icon="📌" text="このアカウントはAPI接続済み。SBI≤2を連続3日確認するまで投稿ゼロ。計測のみ実行中。" />
          </div>
        )}

        {tab === "studio" && <StudioTab />}

        {tab === "data" && (
          <div className="space-y-4">
            <SectionHeader icon="📊" title="データ分析" sub="投稿履歴・推移・クリック計測" color="text-zinc-400" />

            <div className="rounded-2xl bg-zinc-900 border border-white/5 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">投稿履歴（@ero_senpai1）</p>
                <span className="text-[10px] text-zinc-600">{posts.length}件</span>
              </div>
              <div className="divide-y divide-white/5 max-h-[40vh] overflow-y-auto">
                {posts.length === 0 ? (
                  <p className="px-4 py-10 text-center text-zinc-500 text-[12px]">データなし</p>
                ) : posts.map(p => (
                  <div key={p.tweetId} className="px-4 py-3">
                    <div className="flex items-start gap-2 mb-1">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${typePill(p.type)}`}>{typeLabel(p.type)}</span>
                      <span className="text-[10px] text-zinc-500 ml-auto shrink-0">{fmtDate(p.postedAt)}</span>
                    </div>
                    <p className="text-[11px] text-zinc-300 leading-relaxed line-clamp-2 mt-1">{p.text}</p>
                    {p.metrics && (
                      <div className="flex items-center gap-3 mt-2">
                        {p.metrics.impression_count != null && <span className="text-[10px] text-zinc-500">👁 {p.metrics.impression_count}</span>}
                        <span className="text-[10px] text-zinc-500">❤️ {p.metrics.like_count}</span>
                        <span className="text-[10px] text-zinc-500">🔁 {p.metrics.retweet_count}</span>
                        <a href={`https://twitter.com/i/web/status/${p.tweetId}`} target="_blank" rel="noopener noreferrer" className="ml-auto text-[10px] text-blue-400">開く →</a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {posts.filter(p => p.metrics?.impression_count).length > 0 && (
              <div className="rounded-2xl bg-zinc-900 border border-white/5 p-5">
                <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">IP / EV 推移</p>
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={posts.filter(p => p.metrics?.impression_count).sort((a, b) => new Date(a.postedAt).getTime() - new Date(b.postedAt).getTime()).slice(-20).map(p => ({
                    date: fmtDate(p.postedAt).slice(0, 5),
                    ip: p.metrics!.impression_count ?? 0,
                    ev: (p.metrics!.like_count ?? 0) + (p.metrics!.retweet_count ?? 0) * 3,
                  }))} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#71717a" }} />
                    <YAxis tick={{ fontSize: 9, fill: "#71717a" }} />
                    <RechartTooltip contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 11, color: "#fff" }} />
                    <Line type="monotone" dataKey="ip" stroke="#3b82f6" strokeWidth={2} dot={{ fill: "#3b82f6", r: 2 }} name="IP" />
                    <Line type="monotone" dataKey="ev" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: "#8b5cf6", r: 2 }} name="EV" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {safety && safety.riskHistory.length > 0 && (
              <div className="rounded-2xl bg-zinc-900 border border-white/5 p-5">
                <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">リスクスコア推移</p>
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={safety.riskHistory.slice(-14)} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#71717a" }} tickFormatter={v => v.slice(5)} />
                    <YAxis tick={{ fontSize: 9, fill: "#71717a" }} domain={[0, 100]} />
                    <RechartTooltip contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 11, color: "#fff" }} />
                    <Line type="monotone" dataKey="score" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b", r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">クリック計測</p>
                <span className="text-[18px] font-bold text-blue-400">{totalClicks}</span>
              </div>
              {rebrandlyData?.links && rebrandlyData.links.length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {[...rebrandlyData.links].sort((a, b) => b.clicks - a.clicks).slice(0, 10).map(link => {
                    const max = Math.max(...rebrandlyData.links.map(l => l.clicks), 1);
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
              ) : <p className="text-[11px] text-zinc-500 text-center py-4">データなし</p>}
            </div>

            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
              <p className="text-[10px] text-zinc-600 text-center">
                月額: Replit ¥3,000 + X API ¥15,000 + Rebrandly ¥4,350 + Canva ¥1,949 + OpenAI ¥1,500 = <span className="text-amber-400 font-semibold">¥25,799</span>
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-[#0a0a0f]/95 backdrop-blur-xl border-t border-white/5 safe-area-inset-bottom z-50">
        <div className="max-w-lg mx-auto flex">
          {([
            { key: "poll" as Tab, label: "Poll Lab", icon: "🗳️" },
            { key: "senpai" as Tab, label: "先輩", icon: "💎" },
            { key: "studio" as Tab, label: "スタジオ", icon: "🎨" },
            { key: "data" as Tab, label: "データ", icon: "📊" },
          ]).map(({ key, label, icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex-1 py-3 flex flex-col items-center gap-0.5 transition-colors ${tab === key ? "text-blue-400" : "text-zinc-600"}`}>
              <span className="text-[18px]">{icon}</span>
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StudioTab() {
  const [studioMode, setStudioMode] = useState<"generate" | "score">("generate");
  const [prompt, setPrompt] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [genImages, setGenImages] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [scoreMode, setScoreMode] = useState<"url" | "prompt">("url");

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API}/api/bot/nanobanana/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.imageUrl) setGenImages(prev => [data.imageUrl, ...prev]);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const handleScore = async () => {
    setLoading(true); setError(""); setResult(null);
    try {
      let res;
      if (scoreMode === "url") {
        res = await fetch(`${API}/api/bot/image/score`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: imageUrl.trim() }),
        });
      } else {
        res = await fetch(`${API}/api/bot/image/generate-and-score`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: prompt.trim() }),
        });
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
      if (data.imageUrl) { setImageUrl(data.imageUrl); setGenImages(prev => [data.imageUrl, ...prev]); }
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const gradeColor: Record<string, string> = { S: "text-amber-400", A: "text-emerald-400", B: "text-yellow-400", C: "text-red-400" };
  const barColor = (s: number) => s >= 9 ? "bg-amber-400" : s >= 7 ? "bg-emerald-400" : s >= 5 ? "bg-yellow-400" : "bg-red-400";

  const FACE_PROMPT = "RAW photo, cute japanese idol girl, baby face, round chubby cheeks, small cute button nose, large round sparkling eyes with aegyo sal, soft rounded facial features, gentle smile, mouth corners slightly upturned, see-through bangs, straight medium-length dark brown hair, delicate collarbone highlight, warm youthful glow, subtle glossy lips, light blush, natural skin texture with visible pores, fine peach fuzz on cheeks, subsurface scattering on ear tips, tiny beauty mark near jawline, natural stray hair wisps";
  const CAMERA = "shot on Sony A7IV 85mm f/1.4, film grain, volumetric haze";
  const NEGATIVE = "plastic skin, airbrushed skin, overly smooth skin, wax figure, mannequin, CGI, digital art, overexposed, underexposed";

  return (
    <div className="space-y-4">
      <SectionHeader icon="🎨" title="スタジオ" sub="画像生成 + 採点（橋本環奈 = 100点基準）" color="text-pink-400" />

      <div className="flex gap-2">
        <button onClick={() => setStudioMode("generate")}
          className={`flex-1 py-2 rounded-xl text-[12px] font-semibold transition-all ${studioMode === "generate" ? "bg-pink-500/20 text-pink-400 border border-pink-500/30" : "bg-zinc-800 text-zinc-500 border border-white/5"}`}>
          🖼️ 画像生成
        </button>
        <button onClick={() => setStudioMode("score")}
          className={`flex-1 py-2 rounded-xl text-[12px] font-semibold transition-all ${studioMode === "score" ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "bg-zinc-800 text-zinc-500 border border-white/5"}`}>
          🏆 採点
        </button>
      </div>

      {studioMode === "generate" && (
        <>
          <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-2">プロンプト入力</p>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4}
              placeholder="画像のプロンプトを入力..."
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-[12px] text-white placeholder-zinc-600 focus:border-pink-500/50 focus:outline-none resize-none" />

            <div className="flex gap-2 mt-2 flex-wrap">
              <MiniBtn label="共通顔ベース" onClick={() => setPrompt(FACE_PROMPT)} />
              <MiniBtn label="+カメラ" onClick={() => setPrompt(p => p + ", " + CAMERA)} />
              <MiniBtn label="+ネガティブ" onClick={() => setPrompt(p => p + ". Negative: " + NEGATIVE)} />
              <MiniBtn label="水着" onClick={() => setPrompt(p => p + ", wearing white bikini, beach background, summer sunlight")} />
              <MiniBtn label="制服" onClick={() => setPrompt(p => p + ", wearing japanese school uniform, classroom background")} />
              <MiniBtn label="ナース" onClick={() => setPrompt(p => p + ", wearing nurse uniform, hospital background")} />
              <MiniBtn label="メイド" onClick={() => setPrompt(p => p + ", wearing maid outfit, cafe background")} />
            </div>

            <button onClick={handleGenerate} disabled={loading || !prompt.trim()}
              className="mt-3 w-full py-2.5 rounded-lg text-[12px] font-bold transition-all disabled:opacity-40 bg-gradient-to-r from-pink-500 to-purple-500 text-white hover:brightness-110">
              {loading ? "生成中..." : "🖼️ 画像を生成"}
            </button>
          </div>

          {error && <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-3 text-[12px] text-red-400">{error}</div>}

          {genImages.length > 0 && (
            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-2">生成結果（{genImages.length}枚）</p>
              <div className="space-y-3">
                {genImages.map((url, i) => (
                  <div key={i} className="relative">
                    <img src={url} alt={`gen-${i}`} className="w-full rounded-xl object-contain max-h-[400px]" />
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => { setStudioMode("score"); setScoreMode("url"); setImageUrl(url); }}
                        className="flex-1 py-1.5 rounded-lg text-[11px] font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
                        🏆 この画像を採点
                      </button>
                      <button onClick={() => navigator.clipboard.writeText(url)}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-white/5 text-zinc-400 border border-white/5">
                        URL コピー
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {studioMode === "score" && (
        <>
          <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
            <div className="flex gap-2 mb-3">
              <button onClick={() => setScoreMode("url")}
                className={`px-3 py-1.5 text-[11px] rounded-lg font-medium transition-colors ${scoreMode === "url" ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "bg-zinc-800 text-zinc-500 border border-white/5"}`}>
                URL採点
              </button>
              <button onClick={() => setScoreMode("prompt")}
                className={`px-3 py-1.5 text-[11px] rounded-lg font-medium transition-colors ${scoreMode === "prompt" ? "bg-pink-500/20 text-pink-400 border border-pink-500/30" : "bg-zinc-800 text-zinc-500 border border-white/5"}`}>
                生成+採点
              </button>
            </div>
            {scoreMode === "url" ? (
              <input type="text" value={imageUrl} onChange={e => setImageUrl(e.target.value)}
                placeholder="画像URLを貼り付け..."
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-[12px] text-white placeholder-zinc-600 focus:border-blue-500/50 focus:outline-none" />
            ) : (
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
                placeholder="プロンプトを入力..."
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-[12px] text-white placeholder-zinc-600 focus:border-pink-500/50 focus:outline-none resize-none" />
            )}
            <button onClick={handleScore} disabled={loading || (scoreMode === "url" ? !imageUrl.trim() : !prompt.trim())}
              className="mt-3 w-full py-2.5 rounded-lg text-[12px] font-bold transition-all disabled:opacity-40 bg-gradient-to-r from-blue-500 to-purple-500 text-white hover:brightness-110">
              {loading ? "処理中..." : "🏆 採点する"}
            </button>
          </div>

          {error && <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-3 text-[12px] text-red-400">{error}</div>}

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
                    <span className={`text-[36px] font-black ${gradeColor[result.grade] || "text-white"}`}>{result.totalScore ?? result.score?.totalScore}</span>
                    <span className="text-zinc-500 text-[14px] font-medium">/100</span>
                  </div>
                  <div className="text-right">
                    <span className={`text-[22px] font-black ${gradeColor[result.grade ?? result.score?.grade] || "text-white"}`}>{result.grade ?? result.score?.grade}</span>
                    <p className="text-[11px] mt-0.5">{(result.passed ?? result.score?.passed) ? <span className="text-emerald-400">合格</span> : <span className="text-red-400">不合格</span>}</p>
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
                        <div className={`h-1.5 rounded-full ${barColor(item.score)}`} style={{ width: `${item.score * 10}%` }} />
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
            </>
          )}
        </>
      )}
    </div>
  );
}

function SectionHeader({ icon, title, sub, color }: { icon: string; title: string; sub: string; color: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-[24px]">{icon}</span>
      <div>
        <p className={`text-[15px] font-bold ${color}`}>{title}</p>
        <p className="text-[11px] text-zinc-500">{sub}</p>
      </div>
    </div>
  );
}
function Check({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-3 bg-black/20 rounded-lg">
      <span className="text-[12px]">{ok ? "✅" : "⬜"}</span>
      <span className={`text-[11px] ${ok ? "text-zinc-300" : "text-red-400 font-medium"}`}>{label}</span>
    </div>
  );
}
function KPICard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-[24px] font-bold ${color}`}>{value}</p>
    </div>
  );
}
function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/20 rounded-lg p-2 text-center">
      <p className="text-[16px] font-bold">{value}</p>
      <p className="text-[9px] text-zinc-500">{label}</p>
    </div>
  );
}
function InfoCard({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="rounded-2xl bg-blue-500/5 border border-blue-500/10 p-4 flex items-start gap-2">
      <span className="text-[14px]">{icon}</span>
      <p className="text-[11px] text-blue-300 leading-relaxed">{text}</p>
    </div>
  );
}
function QuickBtn({ label, icon, action }: { label: string; icon: string; action: () => Promise<any> }) {
  const [l, setL] = useState(false);
  return (
    <button onClick={async () => { setL(true); try { await action(); } catch {} finally { setL(false); } }} disabled={l}
      className="px-2 py-1 rounded-lg text-[10px] font-medium bg-white/5 text-zinc-400 border border-white/5 hover:bg-white/10 transition-all disabled:opacity-50">
      {l ? "..." : `${icon} ${label}`}
    </button>
  );
}
function ActionBtn({ label, icon, action, variant }: { label: string; icon: string; action: () => Promise<any>; variant?: "danger" }) {
  const [l, setL] = useState(false);
  return (
    <button onClick={async () => { setL(true); try { await action(); } catch {} finally { setL(false); } }} disabled={l}
      className={`py-2.5 rounded-xl text-[12px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 transition-all ${variant === "danger" ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-white/5 text-zinc-300 border border-white/5 hover:bg-white/10"}`}>
      <span>{icon}</span>{l ? "処理中..." : label}
    </button>
  );
}
function MiniBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="px-2 py-1 rounded text-[10px] font-medium bg-white/5 text-zinc-400 border border-white/5 hover:bg-white/10 transition-all">
      {label}
    </button>
  );
}
function Rule({ label, value, sub }: { label: string; value: string; sub?: string }) {
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
