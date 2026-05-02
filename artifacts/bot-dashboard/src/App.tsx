import { useEffect, useState, useCallback } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import MyfansAdmin from "@/pages/myfans-admin";
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

interface SampleVideoStatusResponse {
  ok: boolean;
  sampleVideo: {
    ffmpegAvailable: boolean;
    allowedMakers: string[];
    videoDir: string;
  };
  email: {
    configured: boolean;
    missing: string[];
  };
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


const DAY_THEMES = [
  {
    day: "月", theme: "ジャンル対決",
    polls: [
      { time: "10:30", text: "🔞正直に答えて！\n\nどのジャンルが一番好き？🗳️\n#FANZA", choices: ["巨乳", "美乳", "貧乳", "爆乳"] },
      { time: "20:15", text: "🔞夜の投票タイム🗳️\n\nぶっちゃけどれが好み？\n#FANZA", choices: ["素人", "企画", "単体女優", "VR"] },
    ],
  },
  {
    day: "火", theme: "シチュ対決",
    polls: [
      { time: "10:30", text: "🔞このシチュどっちが興奮する？🗳️\n\n正直に投票して💦\n#FANZA", choices: ["不倫・浮気", "寝取られ"] },
      { time: "20:15", text: "🔞究極の二択🗳️\n\nどっち派？\n#FANZA", choices: ["痴漢もの", "マッサージ"] },
    ],
  },
  {
    day: "水", theme: "属性対決",
    polls: [
      { time: "10:30", text: "🔞ぶっちゃけどの属性が最強？🗳️\n\n投票してね！\n#FANZA", choices: ["JD（女子大生）", "OL", "人妻"] },
      { time: "20:15", text: "🔞夜の属性バトル🗳️\n\nどれに一番惹かれる？\n#FANZA", choices: ["ナース", "女教師", "メイド", "CA"] },
    ],
  },
  {
    day: "木", theme: "体型・見た目対決",
    polls: [
      { time: "10:30", text: "🔞正直に答えてほしい🗳️\n\n女の子の体型、どれが好み？\n#FANZA", choices: ["スレンダー", "ぽっちゃり", "筋肉質", "グラマー"] },
      { time: "20:15", text: "🔞見た目の好み投票🗳️\n\nどっち派？\n#FANZA", choices: ["清楚系", "ギャル系"] },
    ],
  },
  {
    day: "金", theme: "新作・トレンド",
    polls: [
      { time: "10:30", text: "🔞今週のFANZA新作🗳️\n\nどれが気になる？\n\n（選択肢にその週の注目作品タイトルを入れる）\n#FANZA", choices: ["作品A", "作品B", "作品C"] },
      { time: "20:15", text: "🔞週末に見るなら？🗳️\n\n今週の推し作品を投票で決めよう！\n#FANZA", choices: ["ランキング1位", "新作", "セール品", "過去の名作"] },
    ],
  },
  {
    day: "土", theme: "ランキング・歴代",
    polls: [
      { time: "10:30", text: "🔞歴代最強を決めよう🗳️\n\nあなたの推しは？\n\n（選択肢にAV女優名を入れる）\n#FANZA", choices: ["女優A", "女優B", "女優C", "女優D"] },
      { time: "20:15", text: "🔞殿堂入り作品はどれ？🗳️\n\n何度でも見返す名作を教えて！\n#FANZA", choices: ["選択肢1", "選択肢2", "選択肢3"] },
    ],
  },
  {
    day: "日", theme: "フリー・リクエスト",
    polls: [
      { time: "10:30", text: "🔞日曜アンケート🗳️\n\n来週どんなPollが見たい？\n#FANZA", choices: ["ジャンル対決", "女優対決", "シチュ対決", "おまかせ"] },
      { time: "20:15", text: "🔞フォロワーに聞きたい🗳️\n\n普段FANZAでどう探してる？\n#FANZA", choices: ["ランキング", "新作", "セール", "キーワード検索"] },
    ],
  },
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
  const [copied, setCopied] = useState<string | null>(null);
  const [syncingRevenue, setSyncingRevenue] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [rebrandlyAutoMessage, setRebrandlyAutoMessage] = useState("");
  const [revenueQueueMessage, setRevenueQueueMessage] = useState("");

  const { data: status } = useQuery<BotStatus>({
    queryKey: ["botStatus"],
    queryFn: () => fetch(`${API}/api/bot/status`).then(r => r.json()),
    refetchInterval: 30000,
  });
  const { data: postsData, refetch: refetchPosts } = useQuery<{ posts: Post[] }>({
    queryKey: ["botPosts"],
    queryFn: () => fetch(`${API}/api/bot/posts`).then(r => r.json()),
    refetchInterval: 60000,
  });
  const { data: safetyData, refetch: refetchSafety } = useQuery<SafetyStatus>({
    queryKey: ["safety"],
    queryFn: () => fetch(`${API}/api/safety/status`).then(r => r.json()),
    refetchInterval: 30000,
  });
  const { data: rebrandlyData, refetch: refetchRebrandly } = useQuery<{
    links: Array<{ id: string; slashtag: string; destination: string; title: string; clicks: number }>;
    lastSyncedAt: string | null;
    status?: { apiKeyConfigured: boolean; storedLinks: number; totalClicks: number; lastSyncedAt: string | null };
  }>({
    queryKey: ["rebrandly"],
    queryFn: () => fetch(`${API}/api/bot/rebrandly`).then(r => r.json()),
    refetchInterval: 600000,
  });
  const { data: queueData, refetch: refetchQueue } = useQuery<{
    ok: boolean; items: any[]; stats: Record<string, number>;
  }>({
    queryKey: ["queue"],
    queryFn: () => fetch(`${API}/api/bot/queue`).then(r => r.json()),
    refetchInterval: 15000,
  });
  const { data: sampleVideoStatusData, refetch: refetchSampleVideoStatus } = useQuery<SampleVideoStatusResponse>({
    queryKey: ["sampleVideoStatus"],
    queryFn: () => fetch(`${API}/api/bot/sample-video/status`).then(r => r.json()),
    refetchInterval: 60000,
  });
  const { data: weeklyReviewData, refetch: refetchWeeklyReview } = useQuery<{
    ok: boolean;
    latest: {
      id: string; generatedAt: string; periodStart: string; periodEnd: string;
      stats: { total: number; posted: number; dryRun: number; avgImpressions: number; avgLikes: number; topCategory: string; topTemplateCategory: string };
      review: {
        winningPatterns: string[]; losingPatterns: string[]; improvements: string[];
        dangerousExpressions: string[]; increaseCategories: string[]; decreaseCategories: string[];
        summary: string;
      };
    } | null;
    history: any[];
  }>({
    queryKey: ["weeklyReview"],
    queryFn: () => fetch(`${API}/api/analytics/weekly-review`).then(r => r.json()),
    refetchInterval: 300000,
  });
  const { data: analyticsStatsData, refetch: refetchAnalyticsStats } = useQuery<{ ok: boolean; stats: { total: number; posted: number; dryRun: number; avgImpressions: number; avgLikes: number; totalClicks: number; ctrPct: number; topCategory: string; topTemplateCategory: string } }>({
    queryKey: ["analyticsStats"],
    queryFn: () => fetch(`${API}/api/analytics/stats?days=7`).then(r => r.json()),
    refetchInterval: 60000,
  });
  const { data: revenueData, refetch: refetchRevenue } = useQuery<{
    ok: boolean;
    stats: { totalClicks: number; ctrPct: number; posted: number; avgImpressions: number };
    topProducts: Array<{ postId: string; productTitle: string; templateCategory: string; clicks: number; impressions: number; shortUrl: string }>;
    topTemplates: Array<{ templateCategory: string; count: number; totalClicks: number; ctrPct: number; verdict?: "win" | "neutral" | "loss" }>;
    templateVerdicts: Array<{ templateCategory: string; count: number; totalClicks: number; ctrPct: number; verdict: "win" | "neutral" | "loss" }>;
    bestHours: Array<{ hour: number; count: number; totalClicks: number; ctrPct: number; score: number }>;
    recommendedHours: number[];
    nextRecommendedHour: number;
    linkReplyTests: Array<{ variant: string; count: number; totalClicks: number; avgClicks: number }>;
    zeroClickPosts: Array<{ postId: string; productTitle: string; impressions: number; shortUrl: string }>;
    zeroClickAnalysis: {
      total: number;
      byTemplate: Array<{ templateCategory: string; count: number; avgImpressions: number }>;
      byHour: Array<{ hour: number; count: number; avgImpressions: number }>;
    };
  }>({
    queryKey: ["revenueSummary"],
    queryFn: () => fetch(`${API}/api/analytics/revenue?days=30`).then(r => r.json()),
    refetchInterval: 60000,
  });
  const { data: runConfigData, refetch: refetchRunConfig } = useQuery<{
    ok: boolean; config: {
      autoPostEnabled: boolean; dryRun: boolean;
      maxPostsPerDay: number; maxPostsPerHour: number;
      cooldownMinutes: number; safetyStrictness: string;
    };
  }>({
    queryKey: ["runConfig"],
    queryFn: () => fetch(`${API}/api/run-config`).then(r => r.json()),
    refetchInterval: 30000,
  });

  const riskScore = safetyData?.riskScore ?? 0;
  const posts = postsData?.posts ?? [];
  const safety = safetyData;
  const stats = status?.stats;
  const totalClicks = rebrandlyData?.links?.reduce((s, l) => s + l.clicks, 0) ?? 0;
  const sampleVideo = sampleVideoStatusData?.sampleVideo;
  const sampleVideoEmail = sampleVideoStatusData?.email;

  const runRevenueSync = async () => {
    setSyncingRevenue(true); setSyncMessage("");
    try {
      const res = await fetch(`${API}/api/analytics/revenue-sync`, { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await Promise.all([refetchPosts(), refetchRebrandly(), refetchAnalyticsStats(), refetchRevenue()]);
      setSyncMessage(`同期完了: クリック${data.rebrandly?.synced ?? 0}件 / 指標${data.metrics?.updated ?? 0}件 / TL${data.timeline?.updatedCount ?? 0}件`);
    } catch (e: any) {
      setSyncMessage(`同期失敗: ${e.message}`);
    } finally {
      setSyncingRevenue(false);
    }
  };

  const runRebrandlyAutoCreate = async () => {
    setRebrandlyAutoMessage("");
    try {
      const res = await fetch(`${API}/api/bot/rebrandly/auto-create`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await refetchRebrandly();
      setRebrandlyAutoMessage(`自動作成: 新規${data.created ?? 0}件 / 既存${data.reused ?? 0}件 / 対象${data.attempted ?? 0}件`);
    } catch (e: any) {
      setRebrandlyAutoMessage(`自動作成失敗: ${e.message}`);
    }
  };

  const runRevenueQueue = async () => {
    setRevenueQueueMessage("");
    try {
      const res = await fetch(`${API}/api/bot/fanza-revenue-queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 3, withImage: true }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await Promise.all([refetchQueue(), refetchRebrandly(), refetchRevenue()]);
      setRevenueQueueMessage(`収益候補: 追加${data.queuedCount ?? 0}/${data.requested ?? 3}件`);
    } catch (e: any) {
      setRevenueQueueMessage(`収益候補失敗: ${e.message}`);
    }
  };

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
          <h1 className="text-[15px] font-bold tracking-tight">FANZA Revenue Ops</h1>
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
            <SectionHeader icon="🗳️" title="Poll Lab" sub="@fanza_poll_lab 手動Poll" color="text-blue-400" />

            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">次回投稿</p>
                <span className="text-[11px] text-zinc-400">{getNextPostTime().label}</span>
              </div>
              <p className="text-[36px] font-black text-white text-center tracking-tight">{formatCountdown(countdown)}</p>
              <p className="text-[11px] text-zinc-500 text-center mt-1">
                今日: <span className="text-blue-400 font-medium">{todayTheme.day}曜 — {todayTheme.theme}</span>
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
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-3">今日のPoll（{todayTheme.day}曜: {todayTheme.theme}）</p>
              {todayTheme.polls.map((poll, idx) => (
                <div key={poll.time} className="bg-black/30 rounded-xl p-3 mb-3 last:mb-0">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">{poll.time}</span>
                      <span className="text-[11px] text-zinc-400">Poll {idx + 1}</span>
                    </div>
                    <button onClick={() => copyTpl(poll.text, poll.time)}
                      className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-all">
                      {copied === poll.time ? "✅ コピー済み" : "本文コピー"}
                    </button>
                  </div>
                  <pre className="text-[11px] text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed mb-2">{poll.text}</pre>
                  <div className="space-y-1">
                    <p className="text-[9px] text-zinc-600 uppercase tracking-wider">投票の選択肢（Xの📊から入力）:</p>
                    {poll.choices.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 bg-zinc-800/50 rounded-lg px-3 py-1.5">
                        <span className="text-[10px] text-blue-400 font-bold w-4">{i + 1}.</span>
                        <span className="text-[11px] text-white">{c}</span>
                      </div>
                    ))}
                  </div>
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

            <InfoCard icon="📌" text="PollはXアプリで手動投稿。リンクなしで反応を取り、収益投稿は運用/投稿タブからキュー投入します。" />
          </div>
        )}

        {tab === "senpai" && (
          <div className="space-y-4">
            <SectionHeader icon="💎" title="運用コントロール" sub="キュー・収益候補・動画付き投稿" color="text-purple-400" />

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
                <ActionBtn label="収益候補を補充" icon="📬" action={runRevenueQueue} />
                <ActionBtn label="リンク同期" icon="🔗" action={async () => { await fetch(`${API}/api/bot/rebrandly/sync`, { method: "POST" }); refetchRebrandly(); }} />
                <ActionBtn label="TL同期" icon="🔄" action={async () => { await fetch(`${API}/api/bot/posts/sync-timeline`, { method: "POST" }); refetchPosts(); }} />
                <ActionBtn label="リンク作成" icon="✨" action={runRebrandlyAutoCreate} />
                <ActionBtn label="指標更新" icon="📊" action={async () => { await fetch(`${API}/api/trigger/metrics`, { method: "POST" }); refetchSafety(); }} />
                <ActionBtn label="スナップショット" icon="📷" action={async () => { await fetch(`${API}/api/bot/snapshots/capture`, { method: "POST" }); refetchSafety(); }} />
              </div>
              {revenueQueueMessage && (
                <p className={`text-[10px] mt-2 ${revenueQueueMessage.startsWith("収益候補失敗") ? "text-red-400" : "text-emerald-300"}`}>{revenueQueueMessage}</p>
              )}
            </div>

            {sampleVideo && (
              <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">🎬 サンプル動画</p>
                    <p className="text-[10px] text-zinc-600">Studio / Discord から動画付き投稿をキュー追加</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => refetchSampleVideoStatus()} className="text-[9px] text-zinc-600 hover:text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800">更新</button>
                    <button onClick={() => setTab("studio")} className="text-[9px] text-blue-300 px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20">Studioへ</button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <MiniStat label="ffmpeg" value={sampleVideo.ffmpegAvailable ? "OK" : "NG"} />
                  <MiniStat label="許可メーカー" value={sampleVideo.allowedMakers.includes("*") ? "全許可" : `${sampleVideo.allowedMakers.length}件`} />
                  <MiniStat label="メール" value={sampleVideoEmail?.configured ? "OK" : "未設定"} />
                </div>
                {!sampleVideo.ffmpegAvailable && (
                  <p className="text-[10px] text-amber-400 bg-amber-500/5 rounded-lg px-3 py-1.5">ffmpeg未検出。Replitのpackages反映後に再起動してください。</p>
                )}
                {sampleVideo.allowedMakers.length === 0 && (
                  <p className="text-[10px] text-amber-400 bg-amber-500/5 rounded-lg px-3 py-1.5">FANZA_SAMPLE_VIDEO_ALLOWED_MAKERS が未設定です。</p>
                )}
                {sampleVideoEmail && !sampleVideoEmail.configured && (
                  <p className="text-[10px] text-zinc-500 bg-black/20 rounded-lg px-3 py-1.5">メール通知未設定: {sampleVideoEmail.missing.join(", ")}</p>
                )}
              </div>
            )}

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

            {/* RunConfig パネル */}
            {runConfigData?.config && (
              <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">⚙️ 運用設定</p>
                  <button onClick={() => refetchRunConfig()} className="text-[9px] text-zinc-600 hover:text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800">更新</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className={`rounded-xl p-3 border text-center cursor-pointer transition-all ${runConfigData.config.autoPostEnabled ? "bg-emerald-500/15 border-emerald-500/30" : "bg-zinc-800 border-white/5"}`}
                    onClick={async () => {
                      await fetch(`${API}/api/run-config`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoPostEnabled: !runConfigData.config.autoPostEnabled }) });
                      refetchRunConfig();
                    }}>
                    <p className={`text-[11px] font-bold ${runConfigData.config.autoPostEnabled ? "text-emerald-400" : "text-zinc-500"}`}>{runConfigData.config.autoPostEnabled ? "✅ 自動投稿ON" : "⏸ 自動投稿OFF"}</p>
                  </div>
                  <div className={`rounded-xl p-3 border text-center cursor-pointer transition-all ${runConfigData.config.dryRun ? "bg-amber-500/15 border-amber-500/30" : "bg-zinc-800 border-white/5"}`}
                    onClick={async () => {
                      await fetch(`${API}/api/run-config`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dryRun: !runConfigData.config.dryRun }) });
                      refetchRunConfig();
                    }}>
                    <p className={`text-[11px] font-bold ${runConfigData.config.dryRun ? "text-amber-400" : "text-zinc-400"}`}>{runConfigData.config.dryRun ? "🧪 DRY_RUN中" : "🟢 本番モード"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-center">
                  <div className="rounded-lg bg-black/30 py-1.5 px-2">
                    <p className="text-[9px] text-zinc-500">日上限</p>
                    <p className="text-[13px] font-bold text-white">{runConfigData.config.maxPostsPerDay}</p>
                  </div>
                  <div className="rounded-lg bg-black/30 py-1.5 px-2">
                    <p className="text-[9px] text-zinc-500">時間上限</p>
                    <p className="text-[13px] font-bold text-white">{runConfigData.config.maxPostsPerHour}</p>
                  </div>
                  <div className="rounded-lg bg-black/30 py-1.5 px-2">
                    <p className="text-[9px] text-zinc-500">安全度</p>
                    <p className="text-[11px] font-bold text-white">{runConfigData.config.safetyStrictness}</p>
                  </div>
                </div>
                {runConfigData.config.dryRun && (
                  <p className="text-[10px] text-amber-400 bg-amber-500/5 rounded-lg px-3 py-1.5">⚠ DRY_RUN中 — 自動スロットは投稿されません。キューの「今すぐ投稿」は手動扱いで本番投稿します。</p>
                )}
                {!runConfigData.config.autoPostEnabled && !runConfigData.config.dryRun && (
                  <p className="text-[10px] text-zinc-500 bg-zinc-800 rounded-lg px-3 py-1.5">ℹ 自動投稿OFF — 生成した投稿はキューに積まれますが投稿されません</p>
                )}
              </div>
            )}

            {/* キューパネル */}
            {queueData && (
              <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">📬 投稿キュー</p>
                  <button onClick={() => refetchQueue()} className="text-[9px] text-zinc-600 hover:text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800">更新</button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { label: "待機中", key: "pending", color: "text-amber-400" },
                    { label: "投稿済", key: "posted", color: "text-emerald-400" },
                    { label: "DRY", key: "dry_run", color: "text-blue-400" },
                  ].map(({ label, key, color }) => (
                    <div key={key} className="rounded-lg bg-black/30 py-2 text-center">
                      <p className="text-[9px] text-zinc-500">{label}</p>
                      <p className={`text-[15px] font-bold ${color}`}>{queueData.stats[key] ?? 0}</p>
                    </div>
                  ))}
                </div>
                {(queueData.stats.failed ?? 0) > 0 && (
                  <p className="text-[10px] text-red-400">⚠ 失敗: {queueData.stats.failed}件</p>
                )}
                {queueData.items.filter((i: any) => i.status === "pending").slice(0, 3).map((item: any) => (
                  <div key={item.id} className="rounded-xl bg-black/30 border border-white/5 p-3 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium">待機</span>
                      {item.provider === "myfans" || item.type === "myfans" ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-pink-500/20 text-pink-400 font-medium">💗 MyFans</span>
                      ) : item.type === "fanza" ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 font-medium">🔞 FANZA</span>
                      ) : (
                        <span className="text-[9px] text-zinc-500">{item.type}</span>
                      )}
                      {item.mediaFiles?.some((m: any) => String(m.type).startsWith("video/")) && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-medium">🎬 動画付き</span>
                      )}
                      {item.itemTitle && (
                        <span className="text-[9px] text-zinc-400 truncate max-w-[120px]">{item.itemTitle}</span>
                      )}
                      <span className="text-[9px] text-zinc-600 ml-auto">{fmtDate(item.createdAt)}</span>
                    </div>
                    <p className="text-[10px] text-zinc-300 line-clamp-2">{item.text}</p>
                    {item.affiliateUrl && (
                      <p className="text-[9px] text-blue-400 truncate">{item.affiliateUrl}</p>
                    )}
                    <div className="flex gap-1.5">
                      <button onClick={async () => { await fetch(`${API}/api/bot/queue/${item.id}/approve`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ manualDirect: true, forceLive: true, bypassSafetyLimits: true, source: "dashboard" }),
                      }); refetchQueue(); }}
                        className="flex-1 py-1.5 rounded-lg text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25">
                        🚀 今すぐ投稿
                      </button>
                      <button onClick={async () => { await fetch(`${API}/api/bot/queue/${item.id}/reject`, { method: "POST" }); refetchQueue(); }}
                        className="flex-1 py-1.5 rounded-lg text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20">
                        ❌ 却下
                      </button>
                    </div>
                  </div>
                ))}
                {queueData.items.filter((i: any) => i.status === "pending").length === 0 && (
                  <p className="text-[11px] text-zinc-600 text-center py-2">待機中の投稿なし</p>
                )}
                {queueData.items.filter((i: any) => i.status === "pending").length > 0 && (
                  <p className="text-[9px] text-zinc-500 bg-black/20 rounded-lg px-3 py-1.5">今すぐ投稿はDiscordと同じ手動投稿扱いです。日次上限/DRY_RUNはスキップし、本文フィルターは実行します。</p>
                )}
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

            <InfoCard icon="📌" text="収益候補の補充、動画付きキュー、今すぐ投稿、クリック同期をここに集約しています。細かい制作は投稿タブ、検証は分析タブで確認します。" />
          </div>
        )}

        {tab === "studio" && <StudioTab sampleVideoStatus={sampleVideoStatusData} onRevenueQueued={() => { refetchQueue(); setTab("senpai"); }} />}

        {tab === "data" && (
          <div className="space-y-4">
            <SectionHeader icon="📊" title="データ分析" sub="投稿履歴・推移・クリック計測" color="text-zinc-400" />

            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">収益データ同期</p>
                  <p className="text-[10px] text-zinc-600">クリック・X指標・直近TLをまとめて更新</p>
                </div>
                <button onClick={runRevenueSync} disabled={syncingRevenue}
                  className="px-3 py-2 rounded-lg text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 disabled:opacity-50">
                  {syncingRevenue ? "同期中..." : "今すぐ同期"}
                </button>
              </div>
              {syncMessage && <p className={`text-[10px] ${syncMessage.startsWith("同期失敗") ? "text-red-400" : "text-blue-300"}`}>{syncMessage}</p>}
            </div>

            {revenueData?.stats && (
              <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">収益導線サマリー（30日）</p>
                  <span className="text-[10px] text-blue-400">CTR {revenueData.stats.ctrPct}%</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-center">
                  <MiniStat label="クリック" value={String(revenueData.stats.totalClicks)} />
                  <MiniStat label="投稿済" value={String(revenueData.stats.posted)} />
                  <MiniStat label="平均IP" value={revenueData.stats.avgImpressions.toLocaleString()} />
                </div>
                {revenueData.topProducts.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[9px] text-zinc-500 uppercase tracking-wider">クリック上位作品</p>
                    {revenueData.topProducts.slice(0, 5).map((p) => (
                      <div key={p.postId} className="rounded-lg bg-black/30 px-3 py-2 flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] text-zinc-300 truncate">{p.productTitle || p.postId}</p>
                          <p className="text-[9px] text-zinc-600">{p.templateCategory} / IP {p.impressions.toLocaleString()}</p>
                        </div>
                        <span className="text-[13px] font-bold text-blue-400">{p.clicks}</span>
                      </div>
                    ))}
                  </div>
                )}
                {revenueData.topTemplates.length > 0 && (
                  <div className="grid grid-cols-2 gap-1.5">
                    {revenueData.topTemplates.slice(0, 4).map((t) => (
                      <div key={t.templateCategory} className="rounded-lg bg-black/30 px-2.5 py-2">
                        <p className="text-[10px] font-semibold text-zinc-300 truncate">
                          {t.templateCategory}
                          {t.verdict === "win" && <span className="ml-1 text-emerald-400">強い</span>}
                          {t.verdict === "loss" && <span className="ml-1 text-red-400">弱い</span>}
                        </p>
                        <p className="text-[9px] text-zinc-500">{t.count}件 / {t.totalClicks}クリック / CTR {t.ctrPct}%</p>
                      </div>
                    ))}
                  </div>
                )}
                {(revenueData.templateVerdicts?.length || revenueData.bestHours?.length || revenueData.linkReplyTests?.length) && (
                  <div className="grid grid-cols-1 gap-2">
                    {revenueData.templateVerdicts?.length > 0 && (
                      <div className="rounded-lg bg-black/25 px-3 py-2">
                        <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">テンプレ勝ち負け</p>
                        <div className="flex flex-wrap gap-1">
                          {revenueData.templateVerdicts.slice(0, 7).map((t) => (
                            <span key={t.templateCategory} className={`px-2 py-1 rounded-lg text-[9px] ${t.verdict === "win" ? "bg-emerald-500/10 text-emerald-300" : t.verdict === "loss" ? "bg-red-500/10 text-red-300" : "bg-zinc-800 text-zinc-400"}`}>
                              {t.templateCategory}:{t.verdict === "win" ? "強" : t.verdict === "loss" ? "弱" : "中"}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {revenueData.bestHours?.length > 0 && (
                      <div className="rounded-lg bg-black/25 px-3 py-2">
                        <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">クリックが強い時間帯</p>
                        <div className="flex flex-wrap gap-1">
                          {revenueData.bestHours.slice(0, 6).map((h) => (
                            <span key={h.hour} className="px-2 py-1 rounded-lg bg-blue-500/10 text-blue-300 text-[9px]">{h.hour}時 CTR {h.ctrPct}%</span>
                          ))}
                        </div>
                        {revenueData.recommendedHours?.length > 0 && (
                          <p className="text-[9px] text-zinc-500 mt-1">推奨: {revenueData.recommendedHours.join(" / ")}時 / 次 {revenueData.nextRecommendedHour}時</p>
                        )}
                      </div>
                    )}
                    {revenueData.bestHours?.length === 0 && revenueData.recommendedHours?.length > 0 && (
                      <div className="rounded-lg bg-black/25 px-3 py-2">
                        <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">推奨投稿時間</p>
                        <div className="flex flex-wrap gap-1">
                          {revenueData.recommendedHours.map((hour) => (
                            <span key={hour} className="px-2 py-1 rounded-lg bg-blue-500/10 text-blue-300 text-[9px]">{hour}時</span>
                          ))}
                        </div>
                        <p className="text-[9px] text-zinc-500 mt-1">次 {revenueData.nextRecommendedHour}時</p>
                      </div>
                    )}
                    {revenueData.linkReplyTests?.length > 0 && (
                      <div className="rounded-lg bg-black/25 px-3 py-2">
                        <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">リンク文AB</p>
                        <div className="flex flex-wrap gap-1">
                          {revenueData.linkReplyTests.slice(0, 4).map((l) => (
                            <span key={l.variant} className="px-2 py-1 rounded-lg bg-purple-500/10 text-purple-300 text-[9px]">{l.variant}: 平均{l.avgClicks}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {revenueData.zeroClickAnalysis?.total > 0 && (
                  <div className="space-y-2">
                    <p className="text-[9px] text-zinc-500 uppercase tracking-wider">クリック0分析（{revenueData.zeroClickAnalysis.total}件）</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {revenueData.zeroClickAnalysis.byTemplate.slice(0, 4).map((z) => (
                        <div key={z.templateCategory} className="rounded-lg bg-red-500/5 border border-red-500/10 px-2.5 py-2">
                          <p className="text-[10px] font-semibold text-red-300 truncate">{z.templateCategory}</p>
                          <p className="text-[9px] text-zinc-500">{z.count}件 / 平均IP {z.avgImpressions.toLocaleString()}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {revenueData.zeroClickAnalysis.byHour.slice(0, 6).map((z) => (
                        <span key={z.hour} className="px-2 py-1 rounded-lg bg-black/30 text-[9px] text-zinc-400">{z.hour}時: {z.count}件</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

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
                <div>
                  <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">クリック計測</p>
                  <p className={`text-[9px] ${rebrandlyData?.status?.apiKeyConfigured ? "text-emerald-400" : "text-amber-400"}`}>
                    {rebrandlyData?.status?.apiKeyConfigured ? "Rebrandly自動作成ON" : "REBRANDLY_API_KEY未設定"}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[18px] font-bold text-blue-400">{totalClicks}</span>
                  <button onClick={runRebrandlyAutoCreate}
                    className="block mt-1 px-2 py-1 rounded-lg text-[9px] font-semibold bg-blue-500/10 text-blue-300 border border-blue-500/20">
                    リンク自動作成
                  </button>
                </div>
              </div>
              {rebrandlyAutoMessage && <p className={`text-[10px] mb-2 ${rebrandlyAutoMessage.startsWith("自動作成失敗") ? "text-red-400" : "text-blue-300"}`}>{rebrandlyAutoMessage}</p>}
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

            {/* 投稿アナリティクス（7日間統計） */}
            {analyticsStatsData?.stats && (
              <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4 space-y-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">📈 投稿アナリティクス（7日間）</p>
                <div className="grid grid-cols-3 gap-1.5 text-center">
                  {[
                    { label: "総投稿数", value: analyticsStatsData.stats.total, color: "text-white" },
                    { label: "投稿済", value: analyticsStatsData.stats.posted, color: "text-emerald-400" },
                    { label: "DRY_RUN", value: analyticsStatsData.stats.dryRun, color: "text-amber-400" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-lg bg-black/30 py-2">
                      <p className="text-[9px] text-zinc-500">{label}</p>
                      <p className={`text-[15px] font-bold ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-center">
                  <div className="rounded-lg bg-black/30 py-2">
                    <p className="text-[9px] text-zinc-500">平均IP</p>
                    <p className="text-[14px] font-bold text-blue-400">{analyticsStatsData.stats.avgImpressions.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-black/30 py-2">
                    <p className="text-[9px] text-zinc-500">多いカテゴリ</p>
                    <p className="text-[11px] font-bold text-purple-400">{analyticsStatsData.stats.topTemplateCategory}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-center">
                  <div className="rounded-lg bg-black/30 py-2">
                    <p className="text-[9px] text-zinc-500">クリック</p>
                    <p className="text-[14px] font-bold text-blue-400">{analyticsStatsData.stats.totalClicks}</p>
                  </div>
                  <div className="rounded-lg bg-black/30 py-2">
                    <p className="text-[9px] text-zinc-500">CTR</p>
                    <p className="text-[14px] font-bold text-emerald-400">{analyticsStatsData.stats.ctrPct}%</p>
                  </div>
                </div>
              </div>
            )}

            {/* 週次AIレビューパネル */}
            <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">🤖 週次AIレビュー</p>
                <div className="flex gap-1.5">
                  <button onClick={() => refetchWeeklyReview()} className="text-[9px] text-zinc-600 hover:text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800">更新</button>
                  <button onClick={async () => {
                    await fetch(`${API}/api/analytics/weekly-review/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) });
                    setTimeout(() => refetchWeeklyReview(), 3000);
                  }} className="text-[9px] text-blue-400 hover:text-blue-300 px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20">
                    ▶ 今すぐ実行
                  </button>
                </div>
              </div>
              {weeklyReviewData?.latest ? (
                <div className="space-y-3">
                  <div className="rounded-lg bg-black/30 px-3 py-2">
                    <p className="text-[9px] text-zinc-500 mb-1">{weeklyReviewData.latest.id} — {fmtDate(weeklyReviewData.latest.generatedAt)}生成</p>
                    <p className="text-[11px] text-zinc-300 leading-relaxed">{weeklyReviewData.latest.review.summary}</p>
                  </div>
                  {weeklyReviewData.latest.review.winningPatterns.length > 0 && (
                    <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-3 py-2.5">
                      <p className="text-[9px] text-emerald-400 font-semibold mb-1.5">✅ 伸びた投稿の特徴</p>
                      {weeklyReviewData.latest.review.winningPatterns.map((p, i) => (
                        <p key={i} className="text-[10px] text-zinc-300 leading-relaxed">・{p}</p>
                      ))}
                    </div>
                  )}
                  {weeklyReviewData.latest.review.improvements.length > 0 && (
                    <div className="rounded-lg bg-blue-500/5 border border-blue-500/15 px-3 py-2.5">
                      <p className="text-[9px] text-blue-400 font-semibold mb-1.5">💡 次週の改善案</p>
                      {weeklyReviewData.latest.review.improvements.map((p, i) => (
                        <p key={i} className="text-[10px] text-zinc-300 leading-relaxed">・{p}</p>
                      ))}
                    </div>
                  )}
                  {weeklyReviewData.latest.review.dangerousExpressions.length > 0 && (
                    <div className="rounded-lg bg-red-500/5 border border-red-500/15 px-3 py-2.5">
                      <p className="text-[9px] text-red-400 font-semibold mb-1.5">⚠ 危険だった表現</p>
                      {weeklyReviewData.latest.review.dangerousExpressions.map((p, i) => (
                        <p key={i} className="text-[10px] text-red-300 leading-relaxed">・{p}</p>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-1.5">
                    {weeklyReviewData.latest.review.increaseCategories.length > 0 && (
                      <div className="rounded-lg bg-purple-500/5 border border-purple-500/15 px-2.5 py-2">
                        <p className="text-[9px] text-purple-400 font-semibold mb-1">📈 増やすべき</p>
                        {weeklyReviewData.latest.review.increaseCategories.map((c, i) => (
                          <p key={i} className="text-[10px] text-zinc-300">・{c}</p>
                        ))}
                      </div>
                    )}
                    {weeklyReviewData.latest.review.decreaseCategories.length > 0 && (
                      <div className="rounded-lg bg-zinc-800 border border-white/5 px-2.5 py-2">
                        <p className="text-[9px] text-zinc-400 font-semibold mb-1">📉 減らすべき</p>
                        {weeklyReviewData.latest.review.decreaseCategories.map((c, i) => (
                          <p key={i} className="text-[10px] text-zinc-400">・{c}</p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="py-6 text-center space-y-2">
                  <p className="text-[12px] text-zinc-500">まだレビューがありません</p>
                  <p className="text-[10px] text-zinc-600">毎週日曜 05:00 JST に自動実行、または「今すぐ実行」で手動実行できます</p>
                </div>
              )}
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
            { key: "poll" as Tab, label: "Poll", icon: "🗳️" },
            { key: "senpai" as Tab, label: "運用", icon: "💎" },
            { key: "studio" as Tab, label: "投稿", icon: "🎨" },
            { key: "data" as Tab, label: "分析", icon: "📊" },
          ]).map(({ key, label, icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex-1 py-3 flex flex-col items-center gap-0.5 transition-colors ${tab === key ? "text-blue-400" : "text-zinc-600"}`}>
              <span className="text-[16px]">{icon}</span>
              <span className="text-[9px] font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface FanzaItem {
  content_id: string; title: string; affiliateURL: string;
  actress: string[]; genre: string[]; reviewCount: number;
  reviewAvg: number | null; thumbnail: string | null;
  sampleImages: string[]; price: string | null; date: string | null;
  sampleMovieUrl?: string | null;
  makers?: string[];
  sampleVideoAllowed?: { allowed: boolean; reason: string; makers: string[]; allowedMakers: string[] };
  revenueScore?: { score: number; qualityScore: number; clickBoost: number; reasons: string[] };
}

function StudioTab({ onRevenueQueued, sampleVideoStatus }: { onRevenueQueued?: () => void; sampleVideoStatus?: SampleVideoStatusResponse }) {
  const [studioMode, setStudioMode] = useState<"tweet" | "generate" | "score" | "clip">("tweet");
  const [prompt, setPrompt] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [genImages, setGenImages] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [scoreMode, setScoreMode] = useState<"url" | "prompt">("url");

  const [searchType, setSearchType] = useState("rank");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [autoQueueLoading, setAutoQueueLoading] = useState(false);
  const [selectedQueueLoading, setSelectedQueueLoading] = useState(false);
  const [sampleVideoLoading, setSampleVideoLoading] = useState(false);
  const [sampleVideoClipUrl, setSampleVideoClipUrl] = useState<string | null>(null);
  const [fanzaItems, setFanzaItems] = useState<FanzaItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<FanzaItem | null>(null);
  const [tweetResult, setTweetResult] = useState<{ tweet: string; imagePrompt: string | null; shortUrl: string } | null>(null);
  const [tweetCopied, setTweetCopied] = useState<string | null>(null);
  const [queueMessage, setQueueMessage] = useState("");
  const [genStep, setGenStep] = useState<"search" | "result">("search");
  const [refImages, setRefImages] = useState<string[]>([]);
  const [useRef, setUseRef] = useState(true);
  const [imageEngine, setImageEngine] = useState<string>("auto");
  // MP4アップロードクリップ
  const [clipFile, setClipFile] = useState<File | null>(null);
  const [clipStart, setClipStart] = useState(0);
  const [clipDuration, setClipDuration] = useState(8);
  const [clipLoading, setClipLoading] = useState(false);
  const [clipResult, setClipResult] = useState<{ url: string; filename: string; durationSec: number } | null>(null);
  const [clipError, setClipError] = useState("");

  const handleSearch = async () => {
    setSearchLoading(true); setError(""); setQueueMessage(""); setFanzaItems([]); setSelectedItem(null); setTweetResult(null); setGenStep("search"); setRefImages([]);
    try {
      const params = new URLSearchParams({ type: searchType, count: "10" });
      if ((searchType === "keyword" || searchType === "revenue") && searchKeyword.trim()) params.set("keyword", searchKeyword.trim());
      const res = await fetch(`${API}/api/bot/fanza-search?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setFanzaItems(data.items || []);
    } catch (e: any) { setError(e.message); } finally { setSearchLoading(false); }
  };

  const handleSelectAndGenerate = async (item: FanzaItem) => {
    setSelectedItem(item); setLoading(true); setError(""); setTweetResult(null);
    setRefImages(item.sampleImages?.slice(0, 4) ?? []);
    try {
      const res = await fetch(`${API}/api/bot/generate-tweet`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item: {
            content_id: item.content_id,
            title: item.title,
            affiliateURL: item.affiliateURL,
            actress: item.actress,
            genre: item.genre,
            reviewCount: item.reviewCount,
            reviewAvg: item.reviewAvg,
          },
          type: searchType,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setTweetResult({ tweet: data.tweet, imagePrompt: data.imagePrompt, shortUrl: data.shortUrl || '' });
      if (data.imagePrompt) setPrompt(data.imagePrompt);
      setGenStep("result");
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const handleRevenueQueue = async () => {
    setAutoQueueLoading(true); setError(""); setQueueMessage("");
    try {
      const res = await fetch(`${API}/api/bot/fanza-revenue-queue`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 3, keyword: searchKeyword.trim() || undefined, withImage: true }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setQueueMessage(`収益候補を${data.queuedCount ?? 0}件キューに追加しました`);
      if ((data.queuedCount ?? 0) > 0) setTimeout(() => onRevenueQueued?.(), 700);
    } catch (e: any) { setError(e.message); } finally { setAutoQueueLoading(false); }
  };

  const handleSelectedItemQueue = async () => {
    if (!selectedItem || !tweetResult) return;
    setSelectedQueueLoading(true); setError(""); setQueueMessage("");
    try {
      const res = await fetch(`${API}/api/bot/fanza-item-queue`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item: selectedItem,
          text: tweetResult.tweet,
          withImage: true,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setQueueMessage(`この作品をキューに追加しました（${data.queueItem?.id?.slice(0, 8) ?? ""}）`);
      setTimeout(() => onRevenueQueued?.(), 700);
    } catch (e: any) { setError(e.message); } finally { setSelectedQueueLoading(false); }
  };

  const handleSampleVideoQueue = async () => {
    if (!selectedItem || !tweetResult) return;
    setSampleVideoLoading(true); setSampleVideoClipUrl(null); setError(""); setQueueMessage("");
    try {
      const res = await fetch(`${API}/api/bot/sample-video/queue`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item: selectedItem,
          text: tweetResult.tweet,
          durationSec: 8,
          notifyEmail: "gomishu0930@icloud.com",
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const clipUrl = data.clip?.url ?? null;
      setSampleVideoClipUrl(clipUrl);
      setQueueMessage(`🎬 動画キュー追加完了（${data.queueItem?.id?.slice(0, 8) ?? ""}）`);
      setTimeout(() => onRevenueQueued?.(), 700);
    } catch (e: any) { setError(e.message); } finally { setSampleVideoLoading(false); }
  };

  const handleClipUpload = async () => {
    if (!clipFile) return;
    setClipLoading(true); setClipError(""); setClipResult(null);
    try {
      const form = new FormData();
      form.append("video", clipFile);
      form.append("startSec", String(clipStart));
      form.append("durationSec", String(clipDuration));
      form.append("title", clipFile.name.replace(/\.[^.]+$/, ""));
      const res = await fetch(`${API}/api/bot/sample-video/clip-upload`, { method: "POST", body: form });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setClipResult({ url: data.clip.url, filename: data.clip.filename, durationSec: data.clip.durationSec });
    } catch (e: any) { setClipError(e.message); } finally { setClipLoading(false); }
  };

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => { setTweetCopied(key); setTimeout(() => setTweetCopied(null), 2000); });
  };

  const copyAll = () => {
    if (!tweetResult) return;
    const parts = [tweetResult.tweet];
    if (tweetResult.shortUrl) parts.push('', tweetResult.shortUrl);
    copyText(parts.join('\n'), 'all');
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true); setError("");
    try {
      const body: Record<string, any> = { prompt: prompt.trim(), engine: imageEngine };
      if (useRef && refImages.length > 0 && imageEngine !== 'fal' && imageEngine !== 'dalle') {
        body.referenceImageUrls = refImages;
      }
      const res = await fetch(`${API}/api/bot/nanobanana/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  const QUALITY = "(photorealistic:1.3), (masterpiece:1.2), (best quality:1.2), RAW photo";
  const FACE_BASE = "cute japanese idol girl, baby face, round chubby cheeks, small cute button nose, large round sparkling eyes with aegyo sal, soft rounded facial features, gentle smile, see-through bangs, straight medium-length dark brown hair, warm youthful glow, subtle glossy lips, light blush, natural skin texture with visible pores, fine peach fuzz on cheeks, subsurface scattering on ear tips";
  const SEXY = "(cleavage:1.2), deep neckline, bare shoulders, exposed midriff, skin-tight clothing, alluring pose, glistening skin";
  const LIGHTING = "soft diffused golden-hour sunlight, creamy cinematic bokeh, film grain, volumetric haze";
  const NEGATIVE = "(worst quality:1.4), (low quality:1.4), plastic skin, airbrushed skin, overly smooth skin, wax figure, mannequin, CGI, digital art, illustration, painting, 3d render, deformed iris, deformed pupils, semi-realistic, overexposed, underexposed, watermark, text, logo, cropped";

  return (
    <div className="space-y-4">
      <SectionHeader icon="🎨" title="投稿作成" sub="FANZA検索・収益候補・動画付きキュー" color="text-pink-400" />

      {studioMode === "tweet" && sampleVideoStatus && (
        <div className="rounded-2xl bg-blue-500/5 border border-blue-500/10 p-3">
          <div className="grid grid-cols-3 gap-1.5">
            <MiniStat label="動画処理" value={sampleVideoStatus.sampleVideo.ffmpegAvailable ? "OK" : "NG"} />
            <MiniStat label="許可" value={sampleVideoStatus.sampleVideo.allowedMakers.includes("*") ? "全許可" : `${sampleVideoStatus.sampleVideo.allowedMakers.length}件`} />
            <MiniStat label="通知" value={sampleVideoStatus.email.configured ? "OK" : "未設定"} />
          </div>
        </div>
      )}

      <div className="flex gap-1 flex-wrap">
        <button onClick={() => setStudioMode("tweet")}
          className={`flex-1 py-2 rounded-xl text-[11px] font-semibold transition-all ${studioMode === "tweet" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-zinc-800 text-zinc-500 border border-white/5"}`}>
          ✍️ FANZA投稿
        </button>
        <button onClick={() => setStudioMode("clip")}
          className={`flex-1 py-2 rounded-xl text-[11px] font-semibold transition-all ${studioMode === "clip" ? "bg-violet-500/20 text-violet-400 border border-violet-500/30" : "bg-zinc-800 text-zinc-500 border border-white/5"}`}>
          ✂️ 動画クリップ
        </button>
        <button onClick={() => setStudioMode("generate")}
          className={`flex-1 py-2 rounded-xl text-[11px] font-semibold transition-all ${studioMode === "generate" ? "bg-pink-500/20 text-pink-400 border border-pink-500/30" : "bg-zinc-800 text-zinc-500 border border-white/5"}`}>
          🖼️ 画像生成
        </button>
        <button onClick={() => setStudioMode("score")}
          className={`flex-1 py-2 rounded-xl text-[11px] font-semibold transition-all ${studioMode === "score" ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "bg-zinc-800 text-zinc-500 border border-white/5"}`}>
          🏆 採点
        </button>
      </div>

      {studioMode === "tweet" && (
        <>
          <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-3">FANZA作品検索 → 投稿文生成 → キュー投入</p>

            <div className="flex gap-1 flex-wrap mb-2">
              {[
                { value: "rank", label: "ランキング" },
                { value: "amateur", label: "素人" },
                { value: "sale", label: "セール" },
                { value: "buzz", label: "バズ" },
                { value: "revenue", label: "収益候補" },
                { value: "random", label: "ランダム" },
                { value: "keyword", label: "キーワード" },
              ].map(t => (
                <button key={t.value} onClick={() => setSearchType(t.value)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${searchType === t.value ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-zinc-800 text-zinc-500 border border-white/5"}`}>
                  {t.label}
                </button>
              ))}
            </div>

            {(searchType === "keyword" || searchType === "revenue") && (
              <input type="text" value={searchKeyword} onChange={e => setSearchKeyword(e.target.value)}
                placeholder={searchType === "revenue" ? "任意キーワード（空でもOK）" : "検索キーワード（例: 巨乳 OL）"}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-white placeholder-zinc-600 focus:border-emerald-500/50 focus:outline-none mb-2" />
            )}

            <button onClick={handleSearch} disabled={searchLoading || (searchType === "keyword" && !searchKeyword.trim())}
              className="w-full py-2.5 rounded-lg text-[12px] font-bold transition-all disabled:opacity-40 bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:brightness-110">
              {searchLoading ? "検索中..." : searchType === "revenue" ? "収益候補を検索" : "FANZA作品を検索"}
            </button>
            {searchType === "revenue" && (
              <button onClick={handleRevenueQueue} disabled={autoQueueLoading}
                className="mt-2 w-full py-2.5 rounded-lg text-[12px] font-bold transition-all disabled:opacity-40 bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30">
                {autoQueueLoading ? "キュー追加中..." : "上位3件をキュー追加"}
              </button>
            )}
          </div>

          {error && <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-3 text-[12px] text-red-400">{error}</div>}
          {queueMessage && <div className="rounded-2xl bg-blue-500/10 border border-blue-500/20 p-3 text-[12px] text-blue-300">{queueMessage}</div>}

          {fanzaItems.length > 0 && genStep === "search" && (
            <div className="space-y-2">
              <p className="text-[10px] text-zinc-500 font-medium">{fanzaItems.length}件の作品 — タップで投稿文を自動生成</p>
              {fanzaItems.map((item) => (
                <button key={item.content_id} onClick={() => handleSelectAndGenerate(item)} disabled={loading && selectedItem?.content_id === item.content_id}
                  className={`w-full text-left rounded-2xl border p-3 transition-all ${
                    loading && selectedItem?.content_id === item.content_id
                      ? "bg-emerald-500/10 border-emerald-500/30 animate-pulse"
                      : "bg-zinc-900 border-white/5 hover:border-emerald-500/30 hover:bg-zinc-800"
                  }`}>
                  <div className="flex gap-3">
                    {item.thumbnail && (
                      <img src={item.thumbnail} alt="" className="w-16 h-20 object-cover rounded-lg flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-white font-medium leading-tight line-clamp-2">{item.title}</p>
                      {item.actress.length > 0 && (
                        <p className="text-[10px] text-pink-400 mt-0.5">{item.actress.join(", ")}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        {item.revenueScore && (
                          <span className="text-[10px] text-emerald-400 font-bold">収益{item.revenueScore.score}</span>
                        )}
                        {item.reviewAvg && (
                          <span className="text-[10px] text-amber-400">★{item.reviewAvg}</span>
                        )}
                        {item.reviewCount > 0 && (
                          <span className="text-[10px] text-zinc-500">({item.reviewCount}件)</span>
                        )}
                        {item.price && (
                          <span className="text-[10px] text-zinc-400">{item.price}</span>
                        )}
                        {item.sampleMovieUrl && (
                          <span className={`text-[10px] ${item.sampleVideoAllowed?.allowed ? "text-blue-400" : "text-zinc-500"}`}>
                            動画{item.sampleVideoAllowed?.allowed ? "OK" : "要確認"}
                          </span>
                        )}
                      </div>
                      {item.genre.length > 0 && (
                        <p className="text-[9px] text-zinc-600 mt-1 line-clamp-1">{item.genre.join(" / ")}</p>
                      )}
                      {item.revenueScore?.reasons?.length ? (
                        <p className="text-[9px] text-emerald-500 mt-1 line-clamp-1">{item.revenueScore.reasons.join(" / ")}</p>
                      ) : null}
                    </div>
                    <div className="flex-shrink-0 self-center">
                      {loading && selectedItem?.content_id === item.content_id
                        ? <span className="text-[10px] text-emerald-400">生成中...</span>
                        : <span className="text-[16px]">→</span>
                      }
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {tweetResult && genStep === "result" && (
            <>
              <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] text-emerald-400 uppercase tracking-wider font-bold">投稿文生成完了</p>
                  <div className="flex gap-1">
                    <button onClick={handleSelectedItemQueue} disabled={selectedQueueLoading}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-500 text-white hover:bg-emerald-400 transition-colors disabled:opacity-40">
                      {selectedQueueLoading ? "追加中..." : "キュー追加"}
                    </button>
                    <button onClick={copyAll}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-zinc-800 text-zinc-300 border border-white/5 hover:bg-zinc-700 transition-colors">
                      {tweetCopied === "all" ? "コピー済" : "コピー"}
                    </button>
                  </div>
                </div>
                {selectedItem && (
                  <p className="text-[10px] text-zinc-500 mb-2">{selectedItem.title}</p>
                )}
              </div>

              <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">本文ツイート</p>
                  <button onClick={() => copyText(tweetResult.tweet, "tweet")}
                    className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {tweetCopied === "tweet" ? "✅" : "コピー"}
                  </button>
                </div>
                <pre className="text-[12px] text-zinc-200 whitespace-pre-wrap font-sans leading-relaxed bg-black/20 rounded-lg p-3">{tweetResult.tweet}</pre>
              </div>

              {tweetResult.shortUrl && (
                <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">リプ欄用リンク</p>
                    <button onClick={() => copyText(tweetResult.shortUrl, "link")}
                      className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                      {tweetCopied === "link" ? "✅" : "コピー"}
                    </button>
                  </div>
                  <p className="text-[12px] text-blue-400 bg-black/20 rounded-lg p-3 break-all">{tweetResult.shortUrl}</p>
                </div>
              )}

              <div className="rounded-2xl bg-blue-500/10 border border-blue-500/20 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] text-blue-300 uppercase tracking-wider font-bold">🎬 スライドショー動画</p>
                    <p className="text-[10px] text-zinc-500 truncate">
                      {sampleVideoStatus?.sampleVideo.ffmpegAvailable === false
                        ? "ffmpeg未検出。Replit再起動後に再確認してください"
                        : "サンプル画像からxfadeアニメーション動画を生成しキューに追加します"}
                    </p>
                  </div>
                  <button onClick={handleSampleVideoQueue}
                    disabled={sampleVideoLoading || sampleVideoStatus?.sampleVideo.ffmpegAvailable === false}
                    className="px-3 py-2 rounded-lg text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 disabled:opacity-40 whitespace-nowrap">
                    {sampleVideoLoading ? "生成中..." : "動画キュー追加"}
                  </button>
                </div>
                {selectedItem?.makers?.length ? (
                  <p className="text-[9px] text-zinc-600">メーカー: {selectedItem.makers.join(", ")}</p>
                ) : null}
                {/* 生成された動画のダウンロードリンク */}
                {sampleVideoClipUrl && (
                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 space-y-2">
                    <p className="text-[10px] text-emerald-400 font-semibold">✅ 動画が生成されました</p>
                    <video
                      src={sampleVideoClipUrl}
                      controls
                      className="w-full rounded-lg max-h-48 bg-black"
                      playsInline
                    />
                    <a
                      href={sampleVideoClipUrl}
                      download
                      className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold hover:bg-emerald-500/30 transition-colors"
                    >
                      ⬇ 動画をダウンロード
                    </a>
                  </div>
                )}
              </div>

              {tweetResult.imagePrompt && (
                <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">画像プロンプト</p>
                    <div className="flex gap-1">
                      <button onClick={() => copyText(tweetResult.imagePrompt!, "imgPrompt")}
                        className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-pink-500/20 text-pink-400 border border-pink-500/30">
                        {tweetCopied === "imgPrompt" ? "✅" : "コピー"}
                      </button>
                      <button onClick={() => { setPrompt(tweetResult.imagePrompt!); setStudioMode("generate"); }}
                        className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-purple-500/20 text-purple-400 border border-purple-500/30">
                        画像生成へ →
                      </button>
                    </div>
                  </div>
                  <pre className="text-[11px] text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed bg-black/20 rounded-lg p-3">{tweetResult.imagePrompt}</pre>
                </div>
              )}

              <button onClick={() => { setGenStep("search"); setTweetResult(null); setSelectedItem(null); }}
                className="w-full py-2 rounded-lg text-[11px] font-medium bg-zinc-800 text-zinc-400 border border-white/5 hover:bg-zinc-700 transition-colors">
                ← 別の作品を選ぶ
              </button>
            </>
          )}
        </>
      )}

      {studioMode === "generate" && (
        <>
          <div className="rounded-2xl bg-zinc-900 border border-white/5 p-4">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-2">プロンプト入力</p>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4}
              placeholder="画像のプロンプトを入力..."
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-[12px] text-white placeholder-zinc-600 focus:border-pink-500/50 focus:outline-none resize-none" />

            <div className="flex gap-2 mt-2 flex-wrap">
              <MiniBtn label="制服" onClick={() => setPrompt(QUALITY + ", " + FACE_BASE + ", " + SEXY + ", in a japanese high-school classroom with afternoon sunlight, wearing micro mini sailor uniform with unbuttoned blouse showing cleavage and thigh-high socks, with seductive upward gaze biting lip, " + LIGHTING + ", shot on Sony A7IV 35mm f/1.8. Negative: " + NEGATIVE)} />
              <MiniBtn label="OL" onClick={() => setPrompt(QUALITY + ", beautiful japanese woman, soft feminine features, almond-shaped sophisticated eyes, elegant smile, side-swept bangs, layered dark brown hair, natural skin texture, " + SEXY + ", in a modern office at night with city view, wearing unbuttoned white blouse with visible bra straps and ultra-tight pencil skirt, with seductive lean forward showing deep cleavage, " + LIGHTING + ", shot on Sony A7IV 50mm f/2.0. Negative: " + NEGATIVE)} />
              <MiniBtn label="彼女" onClick={() => setPrompt(QUALITY + ", " + FACE_BASE + ", " + SEXY + ", in a cozy bedroom with warm lamp light, wearing sheer lace camisole with bare shoulders and short shorts, with inviting smile lying on bed, " + LIGHTING + ", shot on Sony A7IV 35mm f/1.8. Negative: " + NEGATIVE)} />
              <MiniBtn label="水着" onClick={() => setPrompt(QUALITY + ", " + FACE_BASE + ", " + SEXY + ", at tropical beach with crystal water and golden hour, wearing string bikini micro triangle top high-cut bottom wet glistening skin, with arching back wet body playful smile, " + LIGHTING + ", shot on Sony A7IV 85mm f/1.4. Negative: " + NEGATIVE)} />
              <MiniBtn label="ナース" onClick={() => setPrompt(QUALITY + ", " + FACE_BASE + ", " + SEXY + ", in a hospital room at night with dim lighting, wearing tight nurse uniform with deep V neckline short skirt thigh-high white stockings, with leaning forward showing cleavage caring seductive expression, " + LIGHTING + ", shot on Sony A7IV 50mm f/2.0. Negative: " + NEGATIVE)} />
            </div>

            {refImages.length > 0 && (
              <div className="mt-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] text-indigo-300 font-semibold uppercase tracking-wider">📷 参照画像（{refImages.length}枚）</p>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={useRef} onChange={e => setUseRef(e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-indigo-500" />
                    <span className="text-[10px] text-indigo-300">参照ON</span>
                  </label>
                </div>
                <div className="flex gap-1.5 overflow-x-auto">
                  {refImages.map((url, i) => (
                    <img key={i} src={url} alt={`ref-${i}`} className={`w-14 h-14 rounded-lg object-cover border ${useRef ? 'border-indigo-500/50' : 'border-white/10 opacity-40'}`} />
                  ))}
                </div>
                {useRef && <p className="text-[9px] text-indigo-400/60 mt-1.5">サンプル画像の雰囲気を参考に生成します</p>}
              </div>
            )}

            <div className="mt-3 space-y-2">
              <div className="flex gap-1">
                {[
                  { value: "auto", label: "自動(Pony V6)", icon: "🐴" },
                  { value: "fal", label: "Pony V6", icon: "🐴" },
                  { value: "nanobanana", label: "Nano", icon: "🍌" },
                  { value: "dalle", label: "DALL-E", icon: "🎨" },
                ].map(e => (
                  <button key={e.value} onClick={() => setImageEngine(e.value)}
                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${imageEngine === e.value ? "bg-pink-500/20 text-pink-400 border border-pink-500/30" : "bg-zinc-800 text-zinc-500 border border-white/5"}`}>
                    {e.icon} {e.label}
                  </button>
                ))}
              </div>
              <button onClick={handleGenerate} disabled={loading || !prompt.trim()}
                className="w-full py-2.5 rounded-lg text-[12px] font-bold transition-all disabled:opacity-40 bg-gradient-to-r from-pink-500 to-purple-500 text-white hover:brightness-110">
                {loading ? "生成中..." : imageEngine === "fal" ? "🐴 Pony V6 で生成" : imageEngine === "dalle" ? "🎨 DALL-E 3で生成" : imageEngine === "nanobanana" ? "🍌 Nanobananaで生成" : useRef && refImages.length > 0 ? "🖼️ 参照画像で生成" : "🐴 Pony V6 で生成"}
              </button>
            </div>
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

      {studioMode === "clip" && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-violet-500/10 border border-violet-500/20 p-4 space-y-4">
            <p className="text-[10px] text-violet-300 uppercase tracking-wider font-bold">✂️ MP4動画クリップ</p>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              iPhoneでFANZAからダウンロードした動画をここにアップロードして指定区間を切り抜き、ダウンロードできます。
            </p>

            {/* ファイル選択 */}
            <label className="block w-full cursor-pointer">
              <div className={`w-full rounded-xl border-2 border-dashed p-6 text-center transition-all ${clipFile ? "border-violet-500/40 bg-violet-500/5" : "border-white/10 bg-black/20 hover:border-violet-500/30"}`}>
                {clipFile ? (
                  <>
                    <p className="text-[13px] text-violet-300 font-semibold">📹 {clipFile.name}</p>
                    <p className="text-[10px] text-zinc-500 mt-1">{(clipFile.size / 1024 / 1024).toFixed(1)} MB</p>
                  </>
                ) : (
                  <>
                    <p className="text-[24px] mb-1">📁</p>
                    <p className="text-[12px] text-zinc-400">MP4ファイルを選択</p>
                    <p className="text-[10px] text-zinc-600 mt-1">最大200MB</p>
                  </>
                )}
              </div>
              <input
                type="file" accept="video/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) { setClipFile(f); setClipResult(null); setClipError(""); } }}
              />
            </label>

            {/* 切り抜き設定 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-zinc-500 block mb-1">開始（秒）: {clipStart}s</label>
                <input type="range" min={0} max={120} value={clipStart} onChange={e => setClipStart(Number(e.target.value))}
                  className="w-full accent-violet-500" />
              </div>
              <div>
                <label className="text-[10px] text-zinc-500 block mb-1">長さ（秒）: {clipDuration}s</label>
                <input type="range" min={4} max={60} value={clipDuration} onChange={e => setClipDuration(Number(e.target.value))}
                  className="w-full accent-violet-500" />
              </div>
            </div>

            <div className="rounded-lg bg-black/30 px-3 py-2 text-center">
              <p className="text-[11px] text-zinc-300">{clipStart}秒 〜 {clipStart + clipDuration}秒 をクリップ（{clipDuration}秒）</p>
            </div>

            <button onClick={handleClipUpload}
              disabled={!clipFile || clipLoading}
              className="w-full py-3 rounded-xl text-[12px] font-bold transition-all disabled:opacity-40 bg-gradient-to-r from-violet-500 to-purple-500 text-white hover:brightness-110">
              {clipLoading ? "✂️ クリップ処理中..." : "✂️ クリップしてダウンロード"}
            </button>
          </div>

          {clipError && (
            <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-3 text-[12px] text-red-400">{clipError}</div>
          )}

          {clipResult && (
            <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-4 space-y-3">
              <p className="text-[10px] text-emerald-400 font-semibold uppercase">✅ クリップ完成</p>
              <p className="text-[11px] text-zinc-400">{clipResult.filename} — {clipResult.durationSec}秒</p>
              <video src={clipResult.url} controls className="w-full rounded-xl max-h-64 bg-black" playsInline />
              <a href={clipResult.url} download
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[12px] font-bold hover:bg-emerald-500/30 transition-colors">
                ⬇ 動画をダウンロード
              </a>
              <p className="text-[9px] text-zinc-600 text-center break-all">{clipResult.url}</p>
            </div>
          )}

          <div className="rounded-2xl bg-blue-500/5 border border-blue-500/10 p-3">
            <p className="text-[10px] text-blue-300 leading-relaxed">
              💡 FANZAのサンプル動画→iPhoneの「写真」に保存→このページでアップロード→切り抜き→Twitter投稿用MP4をダウンロード
            </p>
          </div>
        </div>
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
            <Route path="/admin/myfans" component={MyfansAdmin} />
            <Route component={NotFound} />
          </Switch>
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
