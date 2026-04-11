import { useEffect, useRef, useState } from "react";
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
  totalPosts: number; postsLast7Days: number;
  lastPostedAt: string | null; lastPostTitle: string | null;
  totalLikes: number; totalRetweets: number;
}
interface BotStatus {
  status: string; uptime: number; account: string; mode?: string;
  abTestWeek?: "W1" | "W2" | "normal";
  schedule: { time: string; type: string; label: string; active?: boolean; reason?: string }[];
  stats: Stats;
}
interface Post {
  tweetId: string; type: string; contentType?: string; text: string;
  item: { id: string; title: string; affiliateURL: string };
  postedAt: string;
  metrics: { like_count: number; retweet_count: number; reply_count?: number; bookmark_count?: number } | null;
}
interface Hypothesis {
  id: string; question: string; status: "pending" | "confirmed" | "rejected" | "adjusted";
  finding: string; adjustment: string | null; testedAt: string;
}
interface DecisionLog { at: string; cycle: number; decisions: string[]; }
interface StrategyData {
  monitorIntervalHours: number; typeWeights: Record<string, number>;
  cycleStats: { lastNewPatterns: number; avgNewPatterns: number; totalCycles: number };
  hypotheses: Hypothesis[]; lastEvaluatedAt: string | null;
  recentDecisions: DecisionLog[];
  dynamicTemplates: { count: number; lastEvolvedAt: string | null; evolutionCount: number };
}
interface AccountSnapshot {
  recordedAt: string; followersCount: number; followingCount: number;
  tweetCount: number; note?: string;
}
interface ResearchSession {
  id: string; topic: string; result: string; model: string;
  startedAt: string; completedAt: string;
}
type Speaker = "user" | "gpt" | "claude" | "grok" | "system";
type Assignee = "user" | "others" | "ai";
interface MeetingMessage { role: "user" | "assistant"; speaker: Speaker; content: string; at: string; }
interface DecisionCandidate {
  id: string; text: string;
  category: MeetingDirective["category"]; priority: MeetingDirective["priority"];
  rationale: string; assignee: Assignee; successCriteria?: string;
}
interface MeetingSession {
  id: string; title: string; createdAt: string; messages: MeetingMessage[];
  researchId?: string; decisionCandidates?: DecisionCandidate[];
}
interface DirectiveExecution { at: string; actionType: string; summary: string; changes: string[]; success: boolean; }
interface MeetingDirective {
  id: string; text: string;
  category: "strategy" | "content" | "timing" | "recovery" | "other";
  assignee: Assignee; priority: "high" | "medium" | "low";
  status: "active" | "completed" | "cancelled";
  source: string; platform?: "x" | "threads";
  createdAt: string; updatedAt: string; executionLog?: DirectiveExecution[];
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────

function formatUptime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", hour12: false,
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", hour12: false, hour: "2-digit", minute: "2-digit",
  });
}
function typeLabel(t: string) {
  const m: Record<string, string> = {
    amateur: "素人", rank: "ランキング", sale: "セール", buzz: "バズ",
    random: "ランダム", celebrity: "芸能人似", impression: "インプ狙い",
    emergency: "緊急", manual: "手動", "meeting-post": "AI会議",
  };
  return m[t] ?? t;
}
function typePill(t: string) {
  const m: Record<string, string> = {
    amateur:      "bg-rose-50 text-rose-600 ring-rose-200",
    rank:         "bg-amber-50 text-amber-600 ring-amber-200",
    sale:         "bg-emerald-50 text-emerald-600 ring-emerald-200",
    buzz:         "bg-pink-50 text-pink-600 ring-pink-200",
    random:       "bg-purple-50 text-purple-600 ring-purple-200",
    celebrity:    "bg-orange-50 text-orange-600 ring-orange-200",
    impression:   "bg-sky-50 text-sky-600 ring-sky-200",
    emergency:    "bg-red-50 text-red-600 ring-red-200",
    manual:       "bg-gray-100 text-gray-600 ring-gray-200",
    "meeting-post": "bg-violet-50 text-violet-600 ring-violet-200",
  };
  return m[t] ?? "bg-gray-100 text-gray-500 ring-gray-200";
}
function calcScore(m: Post["metrics"]) {
  if (!m) return 0;
  return m.like_count + m.retweet_count * 3 + (m.bookmark_count ?? 0) * 2 + (m.reply_count ?? 0);
}

// ─── 共通コンポーネント ────────────────────────────────────────────────────────

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-[#E5E5EA] ${className}`}>
      {children}
    </div>
  );
}
function StatCard({ label, value, sub, color = "text-[#1D1D1F]" }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-[#F2F2F7] rounded-xl p-4">
      <p className="text-[11px] font-medium text-[#8E8E93] mb-1">{label}</p>
      <p className={`text-2xl font-bold tracking-tight ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-[#8E8E93] mt-1">{sub}</p>}
    </div>
  );
}

// ─── チャートコンポーネント（ライトテーマ） ────────────────────────────────

const CHART_GRID = "rgba(0,0,0,0.05)";
const CHART_TICK = { fontSize: 10, fill: "#8E8E93" };
const CHART_TIP = {
  contentStyle: {
    background: "#fff", border: "1px solid #E5E5EA",
    borderRadius: 12, fontSize: 11, color: "#1D1D1F", boxShadow: "0 2px 8px rgba(0,0,0,.08)",
  },
};

function EngagementChart({ posts }: { posts: Post[] }) {
  const data = [...posts]
    .filter((p) => p.metrics)
    .sort((a, b) => new Date(a.postedAt).getTime() - new Date(b.postedAt).getTime())
    .slice(-20)
    .map((p) => ({ date: fmtDate(p.postedAt).slice(0, 5), score: calcScore(p.metrics) }));
  if (data.length === 0)
    return <div className="flex items-center justify-center h-28 text-xs text-[#8E8E93]">データ蓄積中...</div>;
  return (
    <ResponsiveContainer width="100%" height={140}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
        <XAxis dataKey="date" tick={CHART_TICK} />
        <YAxis tick={CHART_TICK} />
        <RechartTooltip {...CHART_TIP} formatter={(v: number) => [v, "スコア"]} />
        <Line type="monotone" dataKey="score" stroke="#007AFF" strokeWidth={2} dot={{ fill: "#007AFF", r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function TypeWeightBar({ weights }: { weights: Record<string, number> }) {
  const COLORS: Record<string, string> = {
    amateur: "#FF6B6B", rank: "#FFB547", sale: "#34C759",
    buzz: "#FF6CAE", random: "#BF5AF2", celebrity: "#FF9500",
  };
  const data = Object.entries(weights).map(([type, weight]) => ({
    type: typeLabel(type), weight: Math.round(weight * 100) / 100, raw: type,
  }));
  return (
    <ResponsiveContainer width="100%" height={100}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
        <XAxis dataKey="type" tick={CHART_TICK} />
        <YAxis domain={[0, 2]} tick={CHART_TICK} />
        <RechartTooltip {...CHART_TIP} formatter={(v: number) => [v.toFixed(2), "重み"]} />
        <Bar dataKey="weight" radius={[4, 4, 0, 0]}>
          {data.map((d) => <Cell key={d.raw} fill={COLORS[d.raw] ?? "#8E8E93"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────

type MainTab = "home" | "posts" | "analysis" | "admin";
type SubTab = "posts" | "algo" | "analysis" | "rebrandly" | "directives" | "meeting";

function Dashboard() {
  const [tick, setTick] = useState(0);
  const [mainTab, setMainTab] = useState<MainTab>("home");
  const [subTab, setSubTab] = useState<SubTab>("posts");

  // Meeting room state
  const [researchTopic, setResearchTopic] = useState("");
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchResult, setResearchResult] = useState<ResearchSession | null>(null);
  const [meetingSession, setMeetingSession] = useState<MeetingSession | null>(null);
  const [meetingCreating, setMeetingCreating] = useState(false);
  const [meetingLoading, setMeetingLoading] = useState(false);
  const [debateRound, setDebateRound] = useState(0);
  const [debateCompleted, setDebateCompleted] = useState(false);
  const [qaRoundsLeft, setQaRoundsLeft] = useState(2);
  const [qaInput, setQaInput] = useState("");
  const [qaLoading, setQaLoading] = useState(false);
  const [candidates, setCandidates] = useState<DecisionCandidate[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [cumulativeScores, setCumulativeScores] = useState<{ gpt: number; claude: number }>({ gpt: 0, claude: 0 });
  const [dirModal, setDirModal] = useState<{ text: string; source: string } | null>(null);
  const [dirForm, setDirForm] = useState<{ category: MeetingDirective["category"]; priority: MeetingDirective["priority"]; assignee: Assignee }>({ category: "other", priority: "medium", assignee: "user" });
  const [dirSaving, setDirSaving] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [algoDiscoveryTab, setAlgoDiscoveryTab] = useState<"pending" | "adopted" | "all">("pending");
  const [algoNewsSearching, setAlgoNewsSearching] = useState(false);
  const [algoRunning, setAlgoRunning] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [meetingSession?.messages.length]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // ─── API Queries ───
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
  const { data: strategy } = useQuery<StrategyData>({
    queryKey: ["strategy", tick],
    queryFn: () => fetch(`${API}/api/bot/strategy`).then((r) => r.json()),
    refetchInterval: 60000,
  });
  const { data: directivesData, refetch: refetchDirectives } = useQuery<{ directives: MeetingDirective[] }>({
    queryKey: ["directives"],
    queryFn: () => fetch(`${API}/api/bot/meeting/directives`).then((r) => r.json()),
    refetchInterval: 30000,
  });
  const { data: algoData, refetch: refetchAlgo } = useQuery<{
    latest: {
      generatedAt: string; sampleSize: number; briefing: string;
      stats: {
        byType: Array<{ type: string; avgImp: number; avgEng: number; count: number }>;
        byHour: Array<{ hour: number; avgImp: number; count: number }>;
        correlations: Record<string, number>;
        topPosts: Array<{ tweetId: string; postedAt: string; type: string; impressions: number; engScore: number }>;
      };
      discussion: { claudeHypothesis: string; o3Challenge: string; claudeSynthesis: string };
    } | null;
    stats: {
      byType: Array<{ type: string; avgImp: number; avgEng: number; count: number }>;
      byHour: Array<{ hour: number; avgImp: number; count: number }>;
      correlations: Record<string, number>;
      topPosts: Array<{ tweetId: string; postedAt: string; type: string; impressions: number; engScore: number }>;
      sampleSize: number;
    };
  }>({
    queryKey: ["algo-insights"],
    queryFn: () => fetch(`${API}/api/bot/algo-insights`).then((r) => r.json()),
    refetchInterval: 600000,
  });
  const { data: discoveryData, refetch: refetchDiscoveries } = useQuery<{
    meta: { lastSearchAt: string | null; pendingCount: number; adoptedCount: number };
    discoveries: Array<{
      id: string; discoveredAt: string; title: string; detail: string;
      sourceUrl: string; sourceDesc: string;
      confidence: "confirmed" | "likely" | "rumored";
      category: "scoring" | "pipeline" | "nsfw" | "other";
      status: "pending" | "adopted" | "rejected";
      reviewNote?: string; reviewedAt?: string;
    }>;
  }>({
    queryKey: ["algo-discoveries"],
    queryFn: () => fetch(`${API}/api/bot/algo-discoveries`).then((r) => r.json()),
    refetchInterval: 300000,
  });
  const { data: rebrandlyData, refetch: refetchRebrandly, isRefetching: rebrandlySyncing } = useQuery<{
    links: Array<{ id: string; slashtag: string; destination: string; title: string; clicks: number; lastSyncedAt: string }>;
    lastSyncedAt: string | null;
  }>({
    queryKey: ["rebrandly"],
    queryFn: () => fetch(`${API}/api/bot/rebrandly`).then((r) => r.json()),
    refetchInterval: 600000,
  });
  const { data: postMeetingData } = useQuery<{ ok: boolean; result: {
    celebrity: string; actress: string; title: string; generatedAt: string;
    step1Grok: string; step2GPT: string; step3Claude: string;
    finalTweet: string; introReply?: string; tweetId?: string;
  } | null }>({
    queryKey: ["post-meeting-latest"],
    queryFn: () => fetch(`${API}/api/bot/post-meeting/latest`, { headers: { "x-admin-token": "fanza-bot-admin" } }).then((r) => r.json()),
    refetchInterval: 60000,
  });
  const { data: visionData } = useQuery<{ ok: boolean; result: {
    celebrity: string; scoredAt: string; adopted: string;
    topScore: number | null; topActress: string;
    scores: Array<{ actressName: string; title: string; score: number | null; jacketUrl: string }>;
  } | null }>({
    queryKey: ["vision-scoring-latest"],
    queryFn: () => fetch(`${API}/api/bot/vision-scoring/latest`, { headers: { "x-admin-token": "fanza-bot-admin" } }).then((r) => r.json()),
    refetchInterval: 60000,
  });

  // ─── Derived Data ───
  const posts = postsData?.posts ?? [];
  const stats = status?.stats;
  const postsWithMetrics = posts.filter((p) => p.metrics);
  const avgScore = postsWithMetrics.length > 0
    ? (postsWithMetrics.reduce((s, p) => s + calcScore(p.metrics), 0) / postsWithMetrics.length).toFixed(1)
    : "—";
  const topPost = postsWithMetrics.length > 0
    ? postsWithMetrics.reduce((best, p) => calcScore(p.metrics) > calcScore(best.metrics) ? p : best)
    : null;
  const activeDirectives = (directivesData?.directives ?? []).filter((d) => d.status === "active");
  const schedule = status?.schedule ?? [{ time: "20:00 JST", type: "celebrity", label: "芸能人アフィリ（1件）" }];

  // ─── Meeting Room Functions ───
  const PRESET_TOPICS = [
    "XのNSFWアフィリエイト投稿において、シャドウバンを回避しながらエンゲージメントを最大化する投稿戦略",
    "FANZA芸能人アフィリエイト投稿のコンバージョン率向上のための文章構成とCTA配置の最適化",
    "X（旧Twitter）の2026年最新アルゴリズムにおけるNSFWコンテンツの配信ロジックと対策",
    "深夜帯（20:00-24:00 JST）のX投稿においてインプレッションを最大化するためのエンゲージメント戦略",
  ];

  async function startResearch(topic: string) {
    if (!topic.trim()) return;
    setResearchLoading(true); setResearchError(null); setResearchResult(null);
    setMeetingSession(null); setDebateRound(0); setDebateCompleted(false);
    setQaRoundsLeft(2); setCandidates([]); setCumulativeScores({ gpt: 0, claude: 0 });
    try {
      // Step1: POST でリサーチ開始（即時202が返る）
      const res = await fetch(`${API}/api/bot/meeting/research`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "リサーチエラー");

      const pendingId = data.session?.id;
      if (!pendingId) throw new Error("リサーチIDが取得できませんでした");

      // Step2: result が埋まるまでポーリング（最大3分 / 5秒間隔）
      const maxAttempts = 36;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const pollRes = await fetch(`${API}/api/bot/meeting/researches/${pendingId}`);
        if (!pollRes.ok) continue;
        const session = await pollRes.json();
        if (session?.result && session.result.length > 0) {
          setResearchResult(session);
          return;
        }
      }
      throw new Error("リサーチがタイムアウトしました（3分超過）");
    } catch (e: any) {
      setResearchError(e.message);
    } finally {
      setResearchLoading(false);
    }
  }

  async function startMeeting() {
    if (!researchResult) return;
    setMeetingCreating(true);
    try {
      const res = await fetch(`${API}/api/bot/meeting/sessions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: researchResult.topic, researchId: researchResult.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "会議作成エラー");
      setMeetingSession(data.session);
    } catch (e: any) {
      setResearchError(e.message);
    } finally {
      setMeetingCreating(false);
    }
  }

  async function sendDebateRound() {
    if (!meetingSession || debateRound >= 5) return;
    setMeetingLoading(true);
    const nextRound = debateRound + 1;
    setDebateRound(nextRound);
    try {
      const res = await fetch(`${API}/api/bot/meeting/sessions/${meetingSession.id}/debate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ round: nextRound }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "ディベートエラー");
      const newMsgs = [data.gptMsg, data.claudeMsg, data.grokMsg].filter(Boolean);
      setMeetingSession((s) => s ? { ...s, messages: [...s.messages, ...newMsgs] } : s);
      if (data.scores) {
        setCumulativeScores((prev) => ({
          gpt: prev.gpt + (data.scores.gpt ?? 0),
          claude: prev.claude + (data.scores.claude ?? 0),
        }));
      }
      if (nextRound >= 5) {
        setDebateCompleted(true);
        const candidates = data.decisionCandidates ?? [];
        setCandidates(candidates);
        setMeetingSession((s) => s ? { ...s, decisionCandidates: candidates } : s);
      }
    } catch (e: any) {
      const errMsg: MeetingMessage = { role: "assistant", speaker: "system", content: `❌ エラー: ${e.message}`, at: new Date().toISOString() };
      setMeetingSession((s) => s ? { ...s, messages: [...s.messages, errMsg] } : s);
    } finally {
      setMeetingLoading(false);
    }
  }

  async function sendQAMessage() {
    if (!meetingSession || !qaInput.trim() || qaRoundsLeft <= 0) return;
    const msg = qaInput.trim();
    setQaInput(""); setQaLoading(true);
    const userMsg: MeetingMessage = { role: "user", speaker: "user", content: msg, at: new Date().toISOString() };
    setMeetingSession((s) => s ? { ...s, messages: [...s.messages, userMsg] } : s);
    try {
      const res = await fetch(`${API}/api/bot/meeting/sessions/${meetingSession.id}/qa`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `エラー ${res.status}`);
      const newMsgs = [data.gptMsg, data.claudeMsg, data.grokMsg].filter(Boolean);
      setMeetingSession((s) => s ? { ...s, messages: [...s.messages, ...newMsgs] } : s);
      setQaRoundsLeft((n) => n - 1);
    } catch (e: any) {
      const errMsg: MeetingMessage = { role: "assistant", speaker: "system", content: `❌ ${e.message}`, at: new Date().toISOString() };
      setMeetingSession((s) => s ? { ...s, messages: [...s.messages, errMsg] } : s);
    } finally {
      setQaLoading(false);
    }
  }

  async function saveCandidate(c: DecisionCandidate) {
    setSavingId(c.id);
    try {
      const res = await fetch(`${API}/api/bot/meeting/directives`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: c.text, category: c.category, priority: c.priority, assignee: c.assignee ?? "user", source: meetingSession ? `会議: ${meetingSession.title}` : "会議室", platform: "x" }),
      });
      await refetchDirectives();
      setCandidates((prev) => prev.filter((x) => x.id !== c.id));
    } catch (e: any) { alert("保存エラー: " + e.message); }
    finally { setSavingId(null); }
  }

  async function saveDirective() {
    if (!dirModal) return;
    setDirSaving(true);
    try {
      await fetch(`${API}/api/bot/meeting/directives`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: dirModal.text, category: dirForm.category, priority: dirForm.priority, assignee: dirForm.assignee, source: dirModal.source, platform: "x" }),
      });
      await refetchDirectives();
      setDirModal(null);
    } catch (e: any) { alert("保存エラー: " + e.message); }
    finally { setDirSaving(false); }
  }

  async function updateDirectiveStatus(id: string, status: MeetingDirective["status"]) {
    await fetch(`${API}/api/bot/meeting/directives/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
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
    } catch (e: any) { alert(`⚡ 実行エラー: ${e.message}`); }
    finally { setExecutingId(null); }
  }

  // ─── Tab Switch Helper ───
  function switchTab(m: MainTab, s?: SubTab) {
    setMainTab(m);
    if (s) setSubTab(s);
    else {
      if (m === "posts") setSubTab("posts");
      if (m === "analysis") setSubTab("algo");
      if (m === "admin") setSubTab("directives");
    }
  }

  const speakerStyle: Record<Speaker, { bg: string; text: string; label: string }> = {
    user:   { bg: "bg-[#007AFF]/10 border border-[#007AFF]/20",   text: "text-[#007AFF]",   label: "👤 あなた" },
    gpt:    { bg: "bg-blue-50 border border-blue-100",             text: "text-blue-700",    label: "🤖 o3 Thinking" },
    claude: { bg: "bg-violet-50 border border-violet-100",         text: "text-violet-700",  label: "🧠 Claude Sonnet" },
    grok:   { bg: "bg-orange-50 border border-orange-100",         text: "text-orange-700",  label: "🦅 Grok" },
    system: { bg: "bg-gray-50 border border-gray-200",             text: "text-gray-500",    label: "📋 システム" },
  };

  // ─── Next Post Countdown ───
  function getNextPostInfo() {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
    const slot = schedule[0];
    if (!slot) return null;
    const [h, m] = slot.time.replace(" JST", "").split(":").map(Number);
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const diff = next.getTime() - now.getTime();
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return { label: slot.label, time: slot.time, hours, mins };
  }
  const nextPost = getNextPostInfo();

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#F5F5F7]" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" }}>

      {/* ── Header ── */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-xl border-b border-[#E5E5EA]">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#1D1D1F] flex items-center justify-center">
              <span className="text-white text-[13px] font-black">𝕏</span>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-[#1D1D1F] leading-none">FANZA Bot</p>
              <p className="text-[10px] text-[#8E8E93] leading-none mt-0.5">{status?.account ?? "@gomi_shu_god"}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {status && (
              <span className="text-[11px] text-[#8E8E93]">{formatUptime(status.uptime)}</span>
            )}
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#34C759] opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#34C759]" />
              </span>
              <span className="text-[11px] font-medium text-[#34C759]">LIVE</span>
            </div>
          </div>
        </div>
      </header>

      {/* ── Sub-tabs for analysis/admin ── */}
      {(mainTab === "analysis" || mainTab === "admin") && (
        <div className="sticky top-14 z-10 bg-white border-b border-[#E5E5EA]">
          <div className="max-w-2xl mx-auto px-4 flex gap-1 py-2 overflow-x-auto scrollbar-none">
            {mainTab === "analysis" && [
              { id: "algo" as SubTab, label: "アルゴ解析" },
              { id: "analysis" as SubTab, label: "パフォーマンス" },
              { id: "rebrandly" as SubTab, label: "リンク計測" },
            ].map((t) => (
              <button key={t.id} onClick={() => setSubTab(t.id)}
                className={`px-3 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap transition-all ${subTab === t.id ? "bg-[#1D1D1F] text-white" : "text-[#6E6E73] hover:bg-[#F2F2F7]"}`}
              >{t.label}</button>
            ))}
            {mainTab === "admin" && [
              { id: "directives" as SubTab, label: "決定事項" },
              { id: "meeting" as SubTab, label: "会議室" },
            ].map((t) => (
              <button key={t.id} onClick={() => setSubTab(t.id)}
                className={`px-3 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap transition-all ${subTab === t.id ? "bg-[#1D1D1F] text-white" : "text-[#6E6E73] hover:bg-[#F2F2F7]"}`}
              >{t.label}</button>
            ))}
          </div>
        </div>
      )}

      <main className="max-w-2xl mx-auto px-4 py-5 pb-28 space-y-4">

        {/* ══════════════════════ ホーム ══════════════════════ */}
        {mainTab === "home" && (
          <>
            {/* ステータスヒーロー */}
            <Card className="overflow-hidden">
              <div className="px-5 pt-5 pb-4">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-[11px] font-semibold text-[#007AFF] uppercase tracking-wider mb-1">
                      {status?.abTestWeek === "W1" ? "W1期間 / A/Bテスト" : status?.mode ?? "運用中"}
                    </p>
                    <h2 className="text-[22px] font-bold text-[#1D1D1F] leading-tight">
                      {status?.abTestWeek === "W1" ? "20:00 JST 自律投稿" : "自律投稿モード"}
                    </h2>
                    <p className="text-[13px] text-[#6E6E73] mt-0.5">芸能人アフィリ / 3者AI会議フロー</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-[#8E8E93] mb-1">次の投稿まで</p>
                    {nextPost ? (
                      <p className="text-[22px] font-bold text-[#1D1D1F] tabular-nums leading-none">
                        {nextPost.hours}h{nextPost.mins.toString().padStart(2,"0")}m
                      </p>
                    ) : (
                      <p className="text-[22px] font-bold text-[#1D1D1F]">—</p>
                    )}
                    <p className="text-[11px] text-[#8E8E93]">{nextPost?.time ?? "—"}</p>
                  </div>
                </div>

                {/* スケジュールスリップ */}
                <div className="space-y-1.5">
                  {schedule.map((s, i) => {
                    const isActive = s.active;
                    return (
                      <div key={i} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${isActive ? "bg-[#007AFF]/8 ring-1 ring-[#007AFF]/20" : "bg-[#F2F2F7]"}`}>
                        <span className={`text-[12px] font-mono font-semibold w-16 shrink-0 ${isActive ? "text-[#007AFF]" : "text-[#8E8E93]"}`}>
                          {s.time.replace(" JST","")}
                        </span>
                        <span className={`text-[12px] flex-1 ${isActive ? "text-[#007AFF] font-semibold" : "text-[#1D1D1F]"}`}>
                          {s.label}
                        </span>
                        {isActive && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#007AFF] shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>

            {/* 統計グリッド */}
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="総投稿数" value={stats?.totalPosts ?? "—"} />
              <StatCard label="7日間" value={stats?.postsLast7Days ?? "—"} sub="件" />
              <StatCard label="平均スコア" value={avgScore} color="text-[#007AFF]" />
            </div>

            {/* 最新3者会議結果 */}
            {postMeetingData?.result && (
              <Card className="overflow-hidden">
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[13px] font-semibold text-[#1D1D1F]">最新 AI会議 投稿結果</p>
                    <span className="text-[11px] text-[#8E8E93]">
                      {fmtDate(postMeetingData.result.generatedAt)}
                    </span>
                  </div>
                  {/* 芸能人 → 女優 バッジ */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-2.5 py-1 bg-orange-50 text-orange-600 text-[11px] font-semibold rounded-full ring-1 ring-orange-200">
                      {postMeetingData.result.celebrity}
                    </span>
                    <span className="text-[#8E8E93] text-[11px]">→</span>
                    <span className="px-2.5 py-1 bg-violet-50 text-violet-600 text-[11px] font-semibold rounded-full ring-1 ring-violet-200">
                      {postMeetingData.result.actress}
                    </span>
                    {postMeetingData.result.tweetId && (
                      <a
                        href={`https://twitter.com/i/web/status/${postMeetingData.result.tweetId}`}
                        target="_blank" rel="noopener noreferrer"
                        className="ml-auto text-[11px] text-[#007AFF] font-medium flex items-center gap-1"
                      >
                        ツイートを見る →
                      </a>
                    )}
                  </div>
                  {/* ツイート本文 */}
                  <div className="bg-[#F2F2F7] rounded-xl px-3 py-2.5">
                    <p className="text-[12px] text-[#1D1D1F] leading-relaxed line-clamp-4 whitespace-pre-wrap">
                      {postMeetingData.result.finalTweet}
                    </p>
                  </div>
                  {/* 3者フロー */}
                  <div className="flex items-center gap-2 mt-3 text-[10px] text-[#8E8E93]">
                    <span className="px-2 py-0.5 bg-[#F2F2F7] rounded-md">🦅 Grok: バズ参考</span>
                    <span>→</span>
                    <span className="px-2 py-0.5 bg-[#F2F2F7] rounded-md">🤖 GPT: 設計</span>
                    <span>→</span>
                    <span className="px-2 py-0.5 bg-[#F2F2F7] rounded-md">🧠 Claude: 生成</span>
                  </div>
                </div>
              </Card>
            )}

            {/* Vision スコアリング */}
            {visionData?.result && (
              <Card className="overflow-hidden">
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[13px] font-semibold text-[#1D1D1F]">👁 Vision 類似度スコアリング</p>
                    <span className="text-[11px] text-[#8E8E93]">
                      {fmtDate(visionData.result.scoredAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-[12px] font-semibold text-[#1D1D1F]">{visionData.result.celebrity}</span>
                    <span className="text-[#8E8E93]">→</span>
                    <span className="text-[12px] font-semibold text-[#34C759]">
                      {visionData.result.adopted || visionData.result.topActress}
                    </span>
                    <span className="ml-auto px-2.5 py-1 bg-[#34C759]/10 text-[#34C759] text-[11px] font-bold rounded-full ring-1 ring-[#34C759]/20">
                      最高 {visionData.result.topScore ?? "—"}/10
                    </span>
                  </div>
                  <div className="space-y-2">
                    {visionData.result.scores.slice(0, 6).map((s, i) => {
                      const score = s.score ?? 0;
                      const pct = (score / 10) * 100;
                      const barColor = score >= 6 ? "bg-[#34C759]" : score >= 4 ? "bg-[#FF9500]" : "bg-[#E5E5EA]";
                      const textColor = score >= 4 ? "text-[#1D1D1F]" : "text-[#8E8E93]";
                      return (
                        <div key={i} className="flex items-center gap-2.5">
                          <span className="text-[11px] text-[#6E6E73] w-24 truncate shrink-0">{s.actressName}</span>
                          <div className="flex-1 h-1.5 bg-[#E5E5EA] rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className={`text-[11px] font-semibold font-mono w-5 text-right shrink-0 ${textColor}`}>
                            {s.score ?? "—"}
                          </span>
                        </div>
                      );
                    })}
                    {visionData.result.scores.length > 6 && (
                      <p className="text-[10px] text-[#8E8E93] text-right">他 {visionData.result.scores.length - 6}件</p>
                    )}
                  </div>
                </div>
              </Card>
            )}

            {/* アクティブ指令 サマリー */}
            {activeDirectives.length > 0 && (
              <Card className="overflow-hidden">
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[13px] font-semibold text-[#1D1D1F]">稼働中の指令</p>
                    <button onClick={() => switchTab("admin", "directives")}
                      className="text-[12px] text-[#007AFF] font-medium">すべて見る →</button>
                  </div>
                  <div className="space-y-2">
                    {activeDirectives.slice(0, 3).map((d) => (
                      <div key={d.id} className="flex items-start gap-3 p-3 bg-[#F2F2F7] rounded-xl">
                        <div className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${d.priority === "high" ? "bg-[#FF3B30]" : d.priority === "medium" ? "bg-[#FF9500]" : "bg-[#8E8E93]"}`} />
                        <p className="text-[12px] text-[#1D1D1F] leading-snug flex-1">{d.text.slice(0, 80)}{d.text.length > 80 ? "..." : ""}</p>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${d.assignee === "ai" ? "bg-[#34C759]/10 text-[#34C759]" : "bg-[#FF9500]/10 text-[#FF9500]"}`}>
                          {d.assignee === "ai" ? "AI" : "手動"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            )}
          </>
        )}

        {/* ══════════════════════ 投稿 ══════════════════════ */}
        {mainTab === "posts" && (
          <>
            {/* 統計ミニ */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="総投稿" value={stats?.totalPosts ?? "—"} sub={`7日間: ${stats?.postsLast7Days ?? "—"}件`} />
              <StatCard label="平均スコア" value={avgScore} sub={`❤️ ${stats?.totalLikes ?? 0}  🔁 ${stats?.totalRetweets ?? 0}`} color="text-[#007AFF]" />
            </div>

            {/* 投稿リスト */}
            <div className="space-y-3">
              {posts.length === 0 ? (
                <Card className="px-5 py-12 text-center">
                  <p className="text-2xl mb-2">📭</p>
                  <p className="text-[14px] font-semibold text-[#1D1D1F]">投稿データなし</p>
                  <p className="text-[12px] text-[#8E8E93] mt-1">初回投稿後にここに表示されます</p>
                </Card>
              ) : (
                [...posts].sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime()).map((p) => {
                  const score = calcScore(p.metrics);
                  const isTop = topPost?.tweetId === p.tweetId;
                  return (
                    <Card key={p.tweetId} className={`overflow-hidden ${isTop ? "ring-1 ring-[#FF9500]/30" : ""}`}>
                      <div className="px-4 py-4">
                        <div className="flex items-center gap-2 mb-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ${typePill(p.type)}`}>
                            {typeLabel(p.type)}
                          </span>
                          {isTop && (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FF9500]/10 text-[#FF9500] ring-1 ring-[#FF9500]/20">
                              🏆 最高スコア
                            </span>
                          )}
                          <span className="ml-auto text-[11px] text-[#8E8E93]">{fmtDate(p.postedAt)}</span>
                        </div>
                        <p className="text-[13px] text-[#1D1D1F] leading-relaxed line-clamp-3 whitespace-pre-wrap mb-3">
                          {p.text}
                        </p>
                        <div className="flex items-center gap-4">
                          {p.metrics ? (
                            <>
                              <span className="flex items-center gap-1 text-[12px] text-[#6E6E73]">❤️ <span className="font-semibold text-[#1D1D1F]">{p.metrics.like_count}</span></span>
                              <span className="flex items-center gap-1 text-[12px] text-[#6E6E73]">🔁 <span className="font-semibold text-[#1D1D1F]">{p.metrics.retweet_count}</span></span>
                              {(p.metrics.reply_count ?? 0) > 0 && <span className="flex items-center gap-1 text-[12px] text-[#6E6E73]">💬 <span className="font-semibold text-[#1D1D1F]">{p.metrics.reply_count}</span></span>}
                              {(p.metrics.bookmark_count ?? 0) > 0 && <span className="flex items-center gap-1 text-[12px] text-[#6E6E73]">🔖 <span className="font-semibold text-[#1D1D1F]">{p.metrics.bookmark_count}</span></span>}
                              {score > 0 && (
                                <span className="ml-auto text-[11px] font-semibold text-[#007AFF] bg-[#007AFF]/8 px-2 py-0.5 rounded-full">
                                  {score}pt
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-[11px] text-[#8E8E93]">計測待ち</span>
                          )}
                          <a
                            href={`https://twitter.com/i/web/status/${p.tweetId}`}
                            target="_blank" rel="noopener noreferrer"
                            className="ml-auto text-[11px] text-[#007AFF] font-medium"
                          >
                            開く →
                          </a>
                        </div>
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* ══════════════════════ 分析 ══════════════════════ */}
        {mainTab === "analysis" && (
          <>
            {/* ── アルゴ解析 ── */}
            {subTab === "algo" && (
              <div className="space-y-4">
                {/* コントロール */}
                <Card className="px-5 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[13px] font-semibold text-[#1D1D1F]">アルゴリズム解析</p>
                      <p className="text-[11px] text-[#8E8E93]">Claude × o3 がデータをもとに議論</p>
                    </div>
                    <button
                      onClick={async () => {
                        setAlgoRunning(true);
                        try {
                          const r = await fetch(`${API}/api/bot/algo-insights/run`, { method: "POST" });
                          const d = await r.json();
                          if (!r.ok) throw new Error(d.error ?? "解析エラー");
                          await refetchAlgo();
                        } catch (e: any) { alert(e.message); }
                        finally { setAlgoRunning(false); }
                      }}
                      disabled={algoRunning}
                      className="px-4 py-2 rounded-xl bg-[#1D1D1F] text-white text-[12px] font-semibold disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {algoRunning ? <><span className="animate-spin">⟳</span>解析中</> : "🔬 今すぐ解析"}
                    </button>
                  </div>
                </Card>

                {/* 最新解析結果 */}
                {algoData?.latest ? (
                  <Card className="overflow-hidden">
                    <div className="px-5 py-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[13px] font-semibold text-[#1D1D1F]">最新ブリーフィング</p>
                        <span className="text-[11px] text-[#8E8E93]">
                          {fmtDate(algoData.latest.generatedAt)} / {algoData.latest.sampleSize}件
                        </span>
                      </div>
                      <div className="bg-gradient-to-br from-[#007AFF]/5 to-violet-50 rounded-xl px-4 py-3 mb-4">
                        <p className="text-[12px] text-[#1D1D1F] leading-relaxed whitespace-pre-wrap">
                          {algoData.latest.briefing}
                        </p>
                      </div>
                      {/* 投稿タイプ別 */}
                      {algoData.latest.stats.byType.length > 0 && (
                        <div>
                          <p className="text-[11px] font-semibold text-[#6E6E73] mb-2">投稿タイプ別 平均インプレッション</p>
                          <div className="space-y-2">
                            {algoData.latest.stats.byType.map((t) => {
                              const max = Math.max(...algoData.latest!.stats.byType.map(x => x.avgImp), 1);
                              return (
                                <div key={t.type} className="flex items-center gap-3">
                                  <span className="text-[11px] text-[#6E6E73] w-20 shrink-0">{t.type} <span className="text-[#8E8E93]">n={t.count}</span></span>
                                  <div className="flex-1 h-1.5 bg-[#E5E5EA] rounded-full overflow-hidden">
                                    <div className="h-full bg-[#007AFF] rounded-full" style={{ width: `${Math.round(t.avgImp / max * 100)}%` }} />
                                  </div>
                                  <span className="text-[11px] font-semibold text-[#1D1D1F] w-16 text-right shrink-0">{t.avgImp.toLocaleString()}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {/* 議論 */}
                      <div className="mt-4 space-y-2">
                        {[
                          { label: "🧠 Claude — 仮説", key: "claudeHypothesis" as const, color: "text-violet-700", bg: "bg-violet-50" },
                          { label: "🤖 o3 — 批判的検証", key: "o3Challenge" as const, color: "text-blue-700", bg: "bg-blue-50" },
                          { label: "🧠 Claude — 統合", key: "claudeSynthesis" as const, color: "text-violet-700", bg: "bg-violet-50" },
                        ].map(({ label, key, color, bg }) => (
                          <details key={key} className={`${bg} rounded-xl border border-[#E5E5EA]`}>
                            <summary className={`text-[12px] font-semibold ${color} px-4 py-3 cursor-pointer select-none`}>{label}</summary>
                            <div className="px-4 pb-3">
                              <p className="text-[12px] text-[#1D1D1F] leading-relaxed whitespace-pre-wrap">
                                {algoData.latest?.discussion[key]}
                              </p>
                            </div>
                          </details>
                        ))}
                      </div>
                    </div>
                  </Card>
                ) : (
                  <Card className="px-5 py-10 text-center">
                    <p className="text-2xl mb-2">🔬</p>
                    <p className="text-[14px] font-semibold text-[#1D1D1F] mb-1">まだ解析データがありません</p>
                    <p className="text-[12px] text-[#8E8E93]">「今すぐ解析」で Claude × o3 の議論が始まります</p>
                  </Card>
                )}

                {/* 新発見 */}
                <Card className="overflow-hidden">
                  <div className="px-5 py-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-[13px] font-semibold text-[#1D1D1F]">アルゴ新発見</p>
                        {(discoveryData?.meta?.pendingCount ?? 0) > 0 && (
                          <span className="text-[11px] text-[#FF9500]">{discoveryData!.meta.pendingCount}件 要確認</span>
                        )}
                      </div>
                      <button
                        onClick={async () => {
                          setAlgoNewsSearching(true);
                          try {
                            const res = await fetch(`${API}/api/bot/algo-discoveries/search`, { method: "POST" });
                            const d = await res.json();
                            if (d.error) alert(d.error);
                            else await refetchDiscoveries();
                          } catch { alert("検索失敗"); }
                          setAlgoNewsSearching(false);
                        }}
                        disabled={algoNewsSearching}
                        className="px-3 py-1.5 rounded-xl bg-[#F2F2F7] text-[12px] font-medium text-[#1D1D1F] disabled:opacity-50"
                      >
                        {algoNewsSearching ? "⏳ 検索中..." : "🔍 今すぐ検索"}
                      </button>
                    </div>
                    {/* サブタブ */}
                    <div className="flex gap-1.5 mb-3">
                      {([["pending", "未確認"], ["adopted", "採用済み"], ["all", "全件"]] as const).map(([v, label]) => (
                        <button key={v} onClick={() => setAlgoDiscoveryTab(v)}
                          className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${algoDiscoveryTab === v ? "bg-[#1D1D1F] text-white" : "bg-[#F2F2F7] text-[#6E6E73]"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {/* 発見リスト */}
                    {(() => {
                      const all = discoveryData?.discoveries ?? [];
                      const filtered = algoDiscoveryTab === "all" ? all : all.filter(d => d.status === algoDiscoveryTab);
                      if (filtered.length === 0) return (
                        <p className="text-[12px] text-[#8E8E93] text-center py-4">
                          {algoDiscoveryTab === "pending" ? "未確認の発見なし" : "なし"}
                        </p>
                      );
                      return (
                        <div className="space-y-2 max-h-72 overflow-y-auto">
                          {filtered.map((d) => {
                            const confColor = d.confidence === "confirmed" ? "text-[#34C759]" : d.confidence === "likely" ? "text-[#FF9500]" : "text-[#FF3B30]";
                            return (
                              <div key={d.id} className={`p-3 rounded-xl border ${d.status === "adopted" ? "border-[#34C759]/20 bg-[#34C759]/5" : d.status === "rejected" ? "border-[#E5E5EA] bg-[#F2F2F7] opacity-50" : "border-[#FF9500]/20 bg-[#FF9500]/5"}`}>
                                <div className="flex items-start justify-between gap-2 mb-1.5">
                                  <p className="text-[12px] font-semibold text-[#1D1D1F] flex-1">{d.title}</p>
                                  {d.status === "pending" && (
                                    <div className="flex gap-1 shrink-0">
                                      <button onClick={async () => { await fetch(`${API}/api/bot/algo-discoveries/${d.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "adopted" }) }); refetchDiscoveries(); }}
                                        className="text-[10px] px-2 py-0.5 rounded-lg bg-[#34C759]/10 text-[#34C759] font-semibold">採用</button>
                                      <button onClick={async () => { await fetch(`${API}/api/bot/algo-discoveries/${d.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "rejected" }) }); refetchDiscoveries(); }}
                                        className="text-[10px] px-2 py-0.5 rounded-lg bg-[#FF3B30]/10 text-[#FF3B30] font-semibold">棄却</button>
                                    </div>
                                  )}
                                </div>
                                <p className="text-[11px] text-[#6E6E73] leading-relaxed mb-1">{d.detail}</p>
                                <div className="flex items-center gap-2">
                                  <span className={`text-[10px] font-semibold ${confColor}`}>[{d.confidence}]</span>
                                  {d.sourceUrl && <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#007AFF] hover:underline truncate">{d.sourceDesc || d.sourceUrl}</a>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </Card>
              </div>
            )}

            {/* ── パフォーマンス ── */}
            {subTab === "analysis" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="総投稿" value={stats?.totalPosts ?? "—"} />
                  <StatCard label="平均エンゲージメント" value={avgScore} color="text-[#007AFF]" />
                  <StatCard label="総いいね" value={stats?.totalLikes ?? "—"} color="text-[#FF3B30]" />
                  <StatCard label="総RT" value={stats?.totalRetweets ?? "—"} color="text-[#34C759]" />
                </div>

                {/* エンゲージメント推移 */}
                <Card className="px-5 py-4">
                  <p className="text-[13px] font-semibold text-[#1D1D1F] mb-3">エンゲージメント推移</p>
                  <EngagementChart posts={posts} />
                </Card>

                {/* トップ投稿 */}
                {topPost && (
                  <Card className="px-5 py-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[13px] font-semibold text-[#1D1D1F]">🏆 最高スコア投稿</p>
                      <span className="text-[12px] font-bold text-[#FF9500]">{calcScore(topPost.metrics)}pt</span>
                    </div>
                    <p className="text-[12px] text-[#1D1D1F] leading-relaxed line-clamp-3 whitespace-pre-wrap bg-[#F2F2F7] rounded-xl px-3 py-2.5">
                      {topPost.text}
                    </p>
                    <div className="flex items-center gap-3 mt-3">
                      <span className="text-[11px] text-[#8E8E93]">{fmtDate(topPost.postedAt)}</span>
                      {topPost.metrics && (
                        <>
                          <span className="text-[11px] text-[#6E6E73]">❤️ {topPost.metrics.like_count}</span>
                          <span className="text-[11px] text-[#6E6E73]">🔁 {topPost.metrics.retweet_count}</span>
                        </>
                      )}
                      <a href={`https://twitter.com/i/web/status/${topPost.tweetId}`} target="_blank" rel="noopener noreferrer"
                        className="ml-auto text-[11px] text-[#007AFF] font-medium">開く →</a>
                    </div>
                  </Card>
                )}

                {/* タイプ重み */}
                {strategy?.typeWeights && Object.keys(strategy.typeWeights).length > 0 && (
                  <Card className="px-5 py-4">
                    <p className="text-[13px] font-semibold text-[#1D1D1F] mb-3">投稿タイプ重み</p>
                    <TypeWeightBar weights={strategy.typeWeights} />
                  </Card>
                )}
              </div>
            )}

            {/* ── リンク計測 ── */}
            {subTab === "rebrandly" && (
              <div className="space-y-4">
                <Card className="px-5 py-4">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-[13px] font-semibold text-[#1D1D1F]">Rebrandly クリック追跡</p>
                      <p className="text-[11px] text-[#8E8E93]">毎日 06:00 JST 自動同期</p>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch(`${API}/api/bot/rebrandly/sync`, { method: "POST" });
                          const data = await res.json();
                          if (data.error) alert(data.error);
                          else await refetchRebrandly();
                        } catch { alert("同期失敗"); }
                      }}
                      disabled={rebrandlySyncing}
                      className="px-4 py-2 rounded-xl bg-[#1D1D1F] text-white text-[12px] font-semibold disabled:opacity-50"
                    >
                      {rebrandlySyncing ? "同期中..." : "🔄 同期"}
                    </button>
                  </div>
                  {(!rebrandlyData?.links || rebrandlyData.links.length === 0) ? (
                    <div className="bg-[#FF9500]/5 border border-[#FF9500]/20 rounded-xl px-4 py-4">
                      <p className="text-[12px] font-semibold text-[#FF9500] mb-1">データなし</p>
                      <p className="text-[11px] text-[#6E6E73]">REBRANDLY_API_KEY を設定すると自動同期されます</p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="bg-[#F2F2F7] rounded-xl p-3 text-center">
                          <p className="text-[20px] font-bold text-[#007AFF]">{rebrandlyData.links.reduce((s, l) => s + l.clicks, 0)}</p>
                          <p className="text-[11px] text-[#8E8E93]">総クリック</p>
                        </div>
                        <div className="bg-[#F2F2F7] rounded-xl p-3 text-center">
                          <p className="text-[20px] font-bold text-[#1D1D1F]">{rebrandlyData.links.length}</p>
                          <p className="text-[11px] text-[#8E8E93]">追跡リンク</p>
                        </div>
                        <div className="bg-[#F2F2F7] rounded-xl p-3 text-center">
                          <p className="text-[12px] font-bold text-[#1D1D1F]">
                            {rebrandlyData.lastSyncedAt ? fmtDate(rebrandlyData.lastSyncedAt) : "—"}
                          </p>
                          <p className="text-[11px] text-[#8E8E93]">最終同期</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {[...rebrandlyData.links].sort((a, b) => b.clicks - a.clicks).map((link) => {
                          const maxClicks = Math.max(...rebrandlyData.links.map((l) => l.clicks), 1);
                          const pct = Math.round((link.clicks / maxClicks) * 100);
                          return (
                            <div key={link.id} className="bg-[#F2F2F7] rounded-xl p-3">
                              <div className="flex items-center justify-between mb-1.5">
                                <p className="text-[12px] font-medium text-[#1D1D1F] truncate flex-1">{link.title || link.slashtag}</p>
                                <span className="text-[14px] font-bold text-[#007AFF] ml-3 shrink-0">{link.clicks}</span>
                              </div>
                              <div className="h-1 bg-[#E5E5EA] rounded-full overflow-hidden">
                                <div className="h-full bg-[#007AFF] rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </Card>
              </div>
            )}
          </>
        )}

        {/* ══════════════════════ 管理 ══════════════════════ */}
        {mainTab === "admin" && (
          <>
            {/* ── 決定事項 ── */}
            {subTab === "directives" && (
              <div className="space-y-4">
                {/* サマリーバッジ */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "AI実行中", count: activeDirectives.filter(d => d.assignee === "ai").length, color: "text-[#34C759]" },
                    { label: "手動対応", count: activeDirectives.filter(d => d.assignee === "user").length, color: "text-[#FF9500]" },
                    { label: "保留中", count: activeDirectives.filter(d => d.assignee === "others").length, color: "text-[#8E8E93]" },
                  ].map((item) => (
                    <div key={item.label} className="bg-white rounded-2xl border border-[#E5E5EA] shadow-sm p-3 text-center">
                      <p className={`text-[22px] font-bold ${item.color}`}>{item.count}</p>
                      <p className="text-[11px] text-[#8E8E93]">{item.label}</p>
                    </div>
                  ))}
                </div>

                {/* カテゴリ別リスト */}
                {[
                  { key: "strategy",  label: "🎯 戦略",     bg: "bg-indigo-50", border: "border-indigo-100" },
                  { key: "content",   label: "✍️ コンテンツ", bg: "bg-pink-50",   border: "border-pink-100"   },
                  { key: "timing",    label: "🕐 タイミング", bg: "bg-amber-50",  border: "border-amber-100"  },
                  { key: "recovery",  label: "🛡️ リスク管理", bg: "bg-red-50",    border: "border-red-100"    },
                  { key: "other",     label: "📌 その他",    bg: "bg-gray-50",   border: "border-gray-200"   },
                ].map(({ key, label, bg, border }) => {
                  const group = activeDirectives.filter((d) => d.category === key);
                  if (group.length === 0) return null;
                  return (
                    <Card key={key} className="overflow-hidden">
                      <div className={`px-4 py-2.5 ${bg} border-b ${border}`}>
                        <p className="text-[12px] font-semibold text-[#1D1D1F]">{label}</p>
                      </div>
                      <div className="divide-y divide-[#F2F2F7]">
                        {group.map((d) => (
                          <div key={d.id} className="px-4 py-3">
                            <div className="flex items-start gap-2.5">
                              <div className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${d.priority === "high" ? "bg-[#FF3B30]" : d.priority === "medium" ? "bg-[#FF9500]" : "bg-[#8E8E93]"}`} />
                              <p className="text-[12px] text-[#1D1D1F] leading-snug flex-1">{d.text}</p>
                            </div>
                            <div className="flex items-center gap-2 mt-2 pl-4">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${d.assignee === "ai" ? "bg-[#34C759]/10 text-[#34C759]" : d.assignee === "user" ? "bg-[#FF9500]/10 text-[#FF9500]" : "bg-[#F2F2F7] text-[#8E8E93]"}`}>
                                {d.assignee === "ai" ? "🤖 AI" : d.assignee === "user" ? "👤 手動" : "⏸ 保留"}
                              </span>
                              <span className="text-[10px] text-[#8E8E93]">{fmtDate(d.createdAt)}</span>
                              <div className="ml-auto flex gap-1.5">
                                {d.assignee === "ai" && (
                                  <button
                                    onClick={() => runExecuteDirective(d.id)}
                                    disabled={executingId === d.id}
                                    className="text-[10px] px-2 py-0.5 rounded-lg bg-[#007AFF]/10 text-[#007AFF] font-semibold disabled:opacity-50"
                                  >
                                    {executingId === d.id ? "実行中..." : "⚡ 実行"}
                                  </button>
                                )}
                                <button
                                  onClick={() => updateDirectiveStatus(d.id, "completed")}
                                  className="text-[10px] px-2 py-0.5 rounded-lg bg-[#34C759]/10 text-[#34C759] font-semibold"
                                >完了</button>
                                <button
                                  onClick={() => updateDirectiveStatus(d.id, "cancelled")}
                                  className="text-[10px] px-2 py-0.5 rounded-lg bg-[#F2F2F7] text-[#8E8E93] font-semibold"
                                >取消</button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  );
                })}

                {activeDirectives.length === 0 && (
                  <Card className="px-5 py-10 text-center">
                    <p className="text-2xl mb-2">✅</p>
                    <p className="text-[14px] font-semibold text-[#1D1D1F]">稼働中の決定事項なし</p>
                    <p className="text-[12px] text-[#8E8E93] mt-1">会議室から新しい指令を作成できます</p>
                  </Card>
                )}
              </div>
            )}

            {/* ── 会議室 ── */}
            {subTab === "meeting" && (
              <div className="space-y-4">
                {/* 参加者紹介 */}
                <Card className="px-5 py-4">
                  <p className="text-[13px] font-semibold text-[#1D1D1F] mb-3">🤝 3者AI会議室</p>
                  <div className="grid grid-cols-3 gap-2.5">
                    {[
                      { icon: "🤖", name: "o3 Thinking", role: "データ分析・立論", color: "bg-blue-50 border-blue-100" },
                      { icon: "🧠", name: "Claude Sonnet", role: "リスク評価・統合", color: "bg-violet-50 border-violet-100" },
                      { icon: "🦅", name: "Grok", role: "X現場・裁定", color: "bg-orange-50 border-orange-100" },
                    ].map((p) => (
                      <div key={p.name} className={`rounded-xl border p-3 text-center ${p.color}`}>
                        <p className="text-xl mb-1">{p.icon}</p>
                        <p className="text-[11px] font-semibold text-[#1D1D1F]">{p.name}</p>
                        <p className="text-[10px] text-[#6E6E73]">{p.role}</p>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* STEP1: リサーチ */}
                <Card className="px-5 py-4">
                  <p className="text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wider mb-3">STEP 1 — Deep Research</p>
                  <div className="grid grid-cols-1 gap-2 mb-3">
                    {PRESET_TOPICS.map((t, i) => (
                      <button
                        key={i}
                        onClick={() => setResearchTopic(t)}
                        disabled={researchLoading}
                        className="text-left text-[11px] text-[#6E6E73] px-3 py-2.5 rounded-xl bg-[#F2F2F7] hover:bg-[#E5E5EA] transition-colors disabled:opacity-40 line-clamp-1"
                      >
                        {["🔍", "💰", "📡", "💬"][i]} {t.slice(0, 55)}…
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={researchTopic}
                    onChange={(e) => setResearchTopic(e.target.value)}
                    placeholder="カスタムトピックを入力..."
                    rows={2}
                    disabled={researchLoading}
                    className="w-full text-[12px] bg-[#F2F2F7] border-0 rounded-xl px-3 py-2.5 text-[#1D1D1F] placeholder-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 resize-none mb-3 disabled:opacity-40"
                  />
                  <button
                    onClick={() => startResearch(researchTopic)}
                    disabled={researchLoading || !researchTopic.trim()}
                    className="w-full py-3 rounded-xl bg-[#1D1D1F] text-white text-[13px] font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {researchLoading ? <><span className="animate-spin">⟳</span>ウェブ検索中...</> : "🔍 Deep Research 起動"}
                  </button>
                  {researchError && (
                    <div className="mt-3 p-3 rounded-xl bg-[#FF3B30]/5 border border-[#FF3B30]/20 text-[12px] text-[#FF3B30]">
                      ❌ {researchError}
                    </div>
                  )}
                </Card>

                {/* リサーチ結果 */}
                {researchResult && (
                  <Card className="px-5 py-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[12px] font-semibold text-[#34C759]">✅ リサーチ完了</p>
                      <button
                        onClick={startMeeting}
                        disabled={meetingCreating || !!meetingSession}
                        className="px-4 py-2 rounded-xl bg-[#007AFF] text-white text-[12px] font-semibold disabled:opacity-40"
                      >
                        {meetingCreating ? "作成中..." : meetingSession ? "会議中" : "💬 会議スタート →"}
                      </button>
                    </div>
                    <div className="bg-[#F2F2F7] rounded-xl px-4 py-3 max-h-48 overflow-y-auto">
                      <p className="text-[12px] text-[#1D1D1F] whitespace-pre-wrap leading-relaxed">{researchResult.result}</p>
                    </div>
                  </Card>
                )}

                {/* STEP2: 会議 */}
                {meetingSession && (
                  <Card className="px-5 py-4">
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wider">STEP 2 — 3者ディベート</p>
                      <div className="flex items-center gap-2">
                        {debateRound > 0 && (
                          <span className="text-[11px] text-[#007AFF] font-semibold">{debateRound}/5 ラウンド</span>
                        )}
                        {/* プログレスバー */}
                        {debateRound > 0 && (
                          <div className="w-20 h-1.5 bg-[#E5E5EA] rounded-full overflow-hidden">
                            <div className="h-full bg-[#007AFF] rounded-full transition-all" style={{ width: `${(debateRound / 5) * 100}%` }} />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* メッセージ */}
                    <div className="space-y-3 max-h-96 overflow-y-auto mb-4 pr-1">
                      {meetingSession.messages.length === 0 && (
                        <div className="text-center py-8">
                          <p className="text-2xl mb-2">🎙</p>
                          <p className="text-[13px] font-semibold text-[#1D1D1F]">準備完了</p>
                          <p className="text-[12px] text-[#8E8E93] mt-1">「ラウンド開始」で5ラウンドのディベートが始まります</p>
                        </div>
                      )}
                      {meetingSession.messages.map((m, i) => {
                        const sp = speakerStyle[m.speaker ?? (m.role === "user" ? "user" : "gpt")];
                        const isUser = m.speaker === "user";
                        return (
                          <div key={i} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                            <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 ${sp.bg}`}>
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <span className={`text-[10px] font-semibold ${sp.text}`}>{sp.label}</span>
                                <span className="text-[10px] text-[#8E8E93]">{fmtTime(m.at)}</span>
                                {!isUser && m.speaker !== "system" && (
                                  <button
                                    onClick={() => setDirModal({ text: m.content.slice(0, 600), source: `会議: ${meetingSession.title}` })}
                                    className="ml-auto text-[10px] px-2 py-0.5 rounded-lg bg-white/70 text-[#007AFF] font-medium border border-[#E5E5EA]"
                                  >
                                    📌 保存
                                  </button>
                                )}
                              </div>
                              <p className="text-[12px] text-[#1D1D1F] leading-relaxed whitespace-pre-wrap">{m.content}</p>
                            </div>
                          </div>
                        );
                      })}
                      {meetingLoading && (
                        <div className="flex justify-center py-4">
                          <div className="flex items-center gap-2 px-4 py-2 bg-[#F2F2F7] rounded-full">
                            <span className="animate-spin text-base">⟳</span>
                            <span className="text-[12px] text-[#6E6E73]">ラウンド {debateRound} ディベート中...</span>
                          </div>
                        </div>
                      )}
                      <div ref={chatEndRef} />
                    </div>

                    {/* ディベートボタン / Q&A */}
                    {!debateCompleted ? (
                      <button
                        onClick={sendDebateRound}
                        disabled={meetingLoading || debateRound >= 5}
                        className="w-full py-3 rounded-xl bg-[#007AFF] text-white text-[13px] font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
                      >
                        {meetingLoading ? <><span className="animate-spin">⟳</span>ラウンド {debateRound} 進行中</> : debateRound === 0 ? "▶ ラウンド1 開始" : debateRound < 5 ? `▶ ラウンド${debateRound + 1} 開始` : "完了"}
                      </button>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-[12px] font-semibold text-[#1D1D1F]">🎤 追加質問（残り {qaRoundsLeft}回）</p>
                        <div className="flex gap-2">
                          <input
                            value={qaInput}
                            onChange={(e) => setQaInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQAMessage(); }}}
                            placeholder="追加で質問する..."
                            disabled={qaLoading || qaRoundsLeft <= 0}
                            className="flex-1 text-[12px] bg-[#F2F2F7] border-0 rounded-xl px-3 py-2.5 text-[#1D1D1F] placeholder-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 disabled:opacity-40"
                          />
                          <button
                            onClick={sendQAMessage}
                            disabled={qaLoading || !qaInput.trim() || qaRoundsLeft <= 0}
                            className="px-4 py-2.5 rounded-xl bg-[#007AFF] text-white text-[12px] font-semibold disabled:opacity-40"
                          >送信</button>
                        </div>
                      </div>
                    )}
                  </Card>
                )}

                {/* STEP3: 決定候補 */}
                {candidates.length > 0 && (
                  <Card className="px-5 py-4">
                    <p className="text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wider mb-3">STEP 3 — 決定候補 ({candidates.length}件)</p>
                    <div className="space-y-3">
                      {candidates.map((c) => (
                        <div key={c.id} className="bg-[#F2F2F7] rounded-xl p-3">
                          <p className="text-[12px] text-[#1D1D1F] leading-snug mb-1.5">{c.text}</p>
                          <p className="text-[11px] text-[#6E6E73] mb-2">{c.rationale}</p>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${c.priority === "high" ? "bg-[#FF3B30]/10 text-[#FF3B30]" : c.priority === "medium" ? "bg-[#FF9500]/10 text-[#FF9500]" : "bg-[#F2F2F7] text-[#8E8E93]"}`}>
                              {c.priority === "high" ? "高" : c.priority === "medium" ? "中" : "低"}
                            </span>
                            <span className="text-[10px] text-[#8E8E93]">{c.category}</span>
                            <button
                              onClick={() => saveCandidate(c)}
                              disabled={savingId === c.id}
                              className="ml-auto px-3 py-1.5 rounded-xl bg-[#007AFF] text-white text-[11px] font-semibold disabled:opacity-50"
                            >
                              {savingId === c.id ? "保存中..." : "📌 決定事項に追加"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </div>
            )}
          </>
        )}

      </main>

      {/* ─── 保存モーダル ──────────────────────────────────────── */}
      {dirModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/20 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-white rounded-t-3xl shadow-2xl px-5 pt-5 pb-8">
            <div className="w-10 h-1 rounded-full bg-[#E5E5EA] mx-auto mb-5" />
            <p className="text-[15px] font-bold text-[#1D1D1F] mb-1">決定事項として保存</p>
            <p className="text-[12px] text-[#6E6E73] mb-4 line-clamp-2">{dirModal.text}</p>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-[11px] font-semibold text-[#6E6E73] uppercase tracking-wider mb-1.5 block">カテゴリ</label>
                <div className="flex flex-wrap gap-2">
                  {(["strategy","content","timing","recovery","other"] as const).map((c) => (
                    <button key={c} onClick={() => setDirForm((f) => ({ ...f, category: c }))}
                      className={`px-3 py-1.5 rounded-xl text-[12px] font-medium border transition-all ${dirForm.category === c ? "bg-[#1D1D1F] text-white border-[#1D1D1F]" : "bg-[#F2F2F7] text-[#6E6E73] border-transparent"}`}>
                      {c === "strategy" ? "戦略" : c === "content" ? "コンテンツ" : c === "timing" ? "タイミング" : c === "recovery" ? "リスク管理" : "その他"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[#6E6E73] uppercase tracking-wider mb-1.5 block">優先度</label>
                <div className="flex gap-2">
                  {(["high","medium","low"] as const).map((p) => (
                    <button key={p} onClick={() => setDirForm((f) => ({ ...f, priority: p }))}
                      className={`flex-1 py-2 rounded-xl text-[12px] font-medium border transition-all ${dirForm.priority === p ? "bg-[#1D1D1F] text-white border-[#1D1D1F]" : "bg-[#F2F2F7] text-[#6E6E73] border-transparent"}`}>
                      {p === "high" ? "🔴 高" : p === "medium" ? "🟡 中" : "⚪ 低"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[#6E6E73] uppercase tracking-wider mb-1.5 block">担当</label>
                <div className="flex gap-2">
                  {(["user","ai","others"] as const).map((a) => (
                    <button key={a} onClick={() => setDirForm((f) => ({ ...f, assignee: a }))}
                      className={`flex-1 py-2 rounded-xl text-[12px] font-medium border transition-all ${dirForm.assignee === a ? "bg-[#1D1D1F] text-white border-[#1D1D1F]" : "bg-[#F2F2F7] text-[#6E6E73] border-transparent"}`}>
                      {a === "user" ? "👤 手動" : a === "ai" ? "🤖 AI" : "⏸ 保留"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDirModal(null)}
                className="flex-1 py-3 rounded-2xl bg-[#F2F2F7] text-[#1D1D1F] text-[14px] font-semibold">
                キャンセル
              </button>
              <button onClick={saveDirective} disabled={dirSaving}
                className="flex-1 py-3 rounded-2xl bg-[#1D1D1F] text-white text-[14px] font-semibold disabled:opacity-50">
                {dirSaving ? "保存中..." : "📌 保存する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── ボトムナビ ──────────────────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white/90 backdrop-blur-xl border-t border-[#E5E5EA]">
        <div className="max-w-2xl mx-auto flex items-stretch" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          {([
            { key: "home" as MainTab,     icon: "house.fill",       label: "ホーム"   },
            { key: "posts" as MainTab,    icon: "list.bullet",      label: "投稿"     },
            { key: "analysis" as MainTab, icon: "chart.bar.fill",   label: "分析"     },
            { key: "admin" as MainTab,    icon: "gearshape.fill",   label: "管理"     },
          ]).map((item) => {
            const isActive = mainTab === item.key;
            const badge = item.key === "admin" && (directivesData?.directives ?? []).filter(d => d.status === "active" && d.assignee === "user").length || 0;
            const discBadge = item.key === "analysis" && (discoveryData?.meta?.pendingCount ?? 0) || 0;
            return (
              <button
                key={item.key}
                onClick={() => switchTab(item.key)}
                className="flex-1 relative flex flex-col items-center justify-center pt-3 pb-2 gap-0.5"
              >
                <NavIcon name={item.icon} active={isActive} />
                <span className={`text-[10px] font-medium transition-colors ${isActive ? "text-[#007AFF]" : "text-[#8E8E93]"}`}>
                  {item.label}
                </span>
                {(badge > 0 || discBadge > 0) && (
                  <span className="absolute top-2 right-1/4 translate-x-1/2 min-w-[16px] h-4 rounded-full bg-[#FF3B30] text-white text-[9px] font-bold flex items-center justify-center px-1">
                    {badge || discBadge}
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

// ─── SF Symbols 風アイコン（SVG） ────────────────────────────────────────────

function NavIcon({ name, active }: { name: string; active: boolean }) {
  const color = active ? "#007AFF" : "#8E8E93";
  const icons: Record<string, JSX.Element> = {
    "house.fill": (
      <svg width="22" height="22" viewBox="0 0 24 24" fill={color}>
        <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
      </svg>
    ),
    "list.bullet": (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
        <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
        <circle cx="3" cy="6" r="1.5" fill={color} /><circle cx="3" cy="12" r="1.5" fill={color} /><circle cx="3" cy="18" r="1.5" fill={color} />
      </svg>
    ),
    "chart.bar.fill": (
      <svg width="22" height="22" viewBox="0 0 24 24" fill={color}>
        <rect x="2" y="14" width="4" height="8" rx="1" /><rect x="9" y="9" width="4" height="13" rx="1" /><rect x="16" y="4" width="4" height="18" rx="1" />
      </svg>
    ),
    "gearshape.fill": (
      <svg width="22" height="22" viewBox="0 0 24 24" fill={color}>
        <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z" />
      </svg>
    ),
  };
  return icons[name] ?? <span style={{ color, fontSize: 20 }}>●</span>;
}

// ─── Routing ─────────────────────────────────────────────────────────────────

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
