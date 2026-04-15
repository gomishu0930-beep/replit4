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

            <div className="rounded-2xl bg-blue-500/5 border border-blue-500/15 p-4">
              <p className="text-[11px] text-blue-400 font-bold mb-2">Pollとは？</p>
              <p className="text-[11px] text-zinc-300 leading-relaxed mb-2">
                Xの「投票機能」です。ツイート作成画面の下部にある📊マークから2〜4択の投票を作れます。
                フォロワーがタップするだけで参加でき、エンゲージメントが爆発的に伸びます。
              </p>
              <div className="space-y-1.5 mb-2">
                <div className="flex items-start gap-2">
                  <span className="text-[10px] text-blue-400 font-bold mt-0.5">1.</span>
                  <p className="text-[10px] text-zinc-400">Xアプリで新規ツイート → 下の📊アイコンをタップ</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[10px] text-blue-400 font-bold mt-0.5">2.</span>
                  <p className="text-[10px] text-zinc-400">選択肢を2つ以上入力（例:「巨乳派」「美乳派」「貧乳派」）</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[10px] text-blue-400 font-bold mt-0.5">3.</span>
                  <p className="text-[10px] text-zinc-400">投票期間を設定（推奨: 24時間）→ ツイート本文に下のテンプレをコピペ</p>
                </div>
              </div>
              <div className="bg-black/20 rounded-lg p-2.5">
                <p className="text-[10px] text-amber-400 font-medium mb-1">なぜPollが最強？</p>
                <p className="text-[10px] text-zinc-400 leading-relaxed">
                  投票=エンゲージメント扱い → アルゴ評価UP → インプレッション爆増。
                  リンクなし・画像なしで凍結リスクもゼロ。1日2本で十分な効果。
                </p>
              </div>
            </div>

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

interface FanzaItem {
  content_id: string; title: string; affiliateURL: string;
  actress: string[]; genre: string[]; reviewCount: number;
  reviewAvg: number | null; thumbnail: string | null;
  sampleImages: string[]; price: string | null; date: string | null;
}

function StudioTab() {
  const [studioMode, setStudioMode] = useState<"tweet" | "generate" | "score">("tweet");
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
  const [fanzaItems, setFanzaItems] = useState<FanzaItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<FanzaItem | null>(null);
  const [tweetResult, setTweetResult] = useState<{ tweet: string; imagePrompt: string | null; shortUrl: string } | null>(null);
  const [tweetCopied, setTweetCopied] = useState<string | null>(null);
  const [genStep, setGenStep] = useState<"search" | "result">("search");
  const [refImages, setRefImages] = useState<string[]>([]);
  const [useRef, setUseRef] = useState(true);
  const [imageEngine, setImageEngine] = useState<string>("auto");

  const handleSearch = async () => {
    setSearchLoading(true); setError(""); setFanzaItems([]); setSelectedItem(null); setTweetResult(null); setGenStep("search"); setRefImages([]);
    try {
      const params = new URLSearchParams({ type: searchType, count: "10" });
      if (searchType === "keyword" && searchKeyword.trim()) params.set("keyword", searchKeyword.trim());
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
  const SFW = "covered chest, modest neckline, appropriate clothing";
  const LIGHTING = "soft diffused golden-hour sunlight, creamy cinematic bokeh, film grain, volumetric haze";
  const NEGATIVE = "(worst quality:1.4), (low quality:1.4), plastic skin, airbrushed skin, overly smooth skin, wax figure, mannequin, CGI, digital art, illustration, painting, 3d render, deformed iris, deformed pupils, semi-realistic, overexposed, underexposed, watermark, text, logo, cropped";

  return (
    <div className="space-y-4">
      <SectionHeader icon="🎨" title="スタジオ" sub="投稿文+画像プロンプト生成・画像生成・採点" color="text-pink-400" />

      <div className="flex gap-1">
        <button onClick={() => setStudioMode("tweet")}
          className={`flex-1 py-2 rounded-xl text-[11px] font-semibold transition-all ${studioMode === "tweet" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-zinc-800 text-zinc-500 border border-white/5"}`}>
          ✍️ 投稿文
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
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-3">FANZA作品検索 → タップで投稿文+リンク自動生成</p>

            <div className="flex gap-1 flex-wrap mb-2">
              {[
                { value: "rank", label: "ランキング" },
                { value: "amateur", label: "素人" },
                { value: "sale", label: "セール" },
                { value: "buzz", label: "バズ" },
                { value: "random", label: "ランダム" },
                { value: "keyword", label: "キーワード" },
              ].map(t => (
                <button key={t.value} onClick={() => setSearchType(t.value)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${searchType === t.value ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-zinc-800 text-zinc-500 border border-white/5"}`}>
                  {t.label}
                </button>
              ))}
            </div>

            {searchType === "keyword" && (
              <input type="text" value={searchKeyword} onChange={e => setSearchKeyword(e.target.value)}
                placeholder="検索キーワード（例: 巨乳 OL）"
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-white placeholder-zinc-600 focus:border-emerald-500/50 focus:outline-none mb-2" />
            )}

            <button onClick={handleSearch} disabled={searchLoading || (searchType === "keyword" && !searchKeyword.trim())}
              className="w-full py-2.5 rounded-lg text-[12px] font-bold transition-all disabled:opacity-40 bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:brightness-110">
              {searchLoading ? "検索中..." : "FANZA作品を検索"}
            </button>
          </div>

          {error && <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-3 text-[12px] text-red-400">{error}</div>}

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
                        {item.reviewAvg && (
                          <span className="text-[10px] text-amber-400">★{item.reviewAvg}</span>
                        )}
                        {item.reviewCount > 0 && (
                          <span className="text-[10px] text-zinc-500">({item.reviewCount}件)</span>
                        )}
                        {item.price && (
                          <span className="text-[10px] text-zinc-400">{item.price}</span>
                        )}
                      </div>
                      {item.genre.length > 0 && (
                        <p className="text-[9px] text-zinc-600 mt-1 line-clamp-1">{item.genre.join(" / ")}</p>
                      )}
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
                  <p className="text-[10px] text-emerald-400 uppercase tracking-wider font-bold">完成 — コピペするだけ！</p>
                  <button onClick={copyAll}
                    className="px-4 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-500 text-white hover:bg-emerald-400 transition-colors">
                    {tweetCopied === "all" ? "✅ コピー済み" : "投稿文+リンクをコピー"}
                  </button>
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
              <MiniBtn label="制服" onClick={() => setPrompt(QUALITY + ", " + FACE_BASE + ", " + SFW + ", in a japanese high-school classroom with afternoon sunlight, wearing neat sailor uniform with skirt at knee, with shy side-glance smile, " + LIGHTING + ", shot on Sony A7IV 35mm f/1.8. Negative: " + NEGATIVE)} />
              <MiniBtn label="OL" onClick={() => setPrompt(QUALITY + ", beautiful japanese woman, soft feminine features, almond-shaped sophisticated eyes, elegant smile, side-swept bangs, layered dark brown hair, natural skin texture, " + SFW + ", in a modern office with glass windows and city view, wearing fitted business blouse and pencil skirt, with confident pose adjusting glasses, " + LIGHTING + ", shot on Sony A7IV 50mm f/2.0. Negative: " + NEGATIVE)} />
              <MiniBtn label="彼女" onClick={() => setPrompt(QUALITY + ", " + FACE_BASE + ", " + SFW + ", in a cozy bedroom with warm lamp light, wearing casual pajamas oversized t-shirt, with bashful smile sitting on bed, " + LIGHTING + ", shot on Sony A7IV 35mm f/1.8. Negative: " + NEGATIVE)} />
              <MiniBtn label="温泉" onClick={() => setPrompt(QUALITY + ", " + FACE_BASE + ", " + SFW + ", in a traditional japanese hot spring inn with wooden corridor, wearing elegant yukata with loosely tied obi, with welcoming gentle bow, " + LIGHTING + ", shot on Sony A7IV 50mm f/2.0. Negative: " + NEGATIVE)} />
              <MiniBtn label="水着" onClick={() => setPrompt(QUALITY + ", " + FACE_BASE + ", " + SFW + ", at tropical beach with crystal water and golden hour, wearing modest one-piece swimsuit, with playful hair flip sunlit smile, " + LIGHTING + ", shot on Sony A7IV 85mm f/1.4. Negative: " + NEGATIVE)} />
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
                  { value: "auto", label: "自動", icon: "⚡" },
                  { value: "fal", label: "fal.ai", icon: "🎯" },
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
                {loading ? "生成中..." : imageEngine === "fal" ? "🎯 fal.ai で生成" : imageEngine === "dalle" ? "🎨 DALL-E 3で生成" : imageEngine === "nanobanana" ? "🍌 Nanobananaで生成" : useRef && refImages.length > 0 ? "🖼️ 参照画像で生成" : "⚡ 画像を生成"}
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
