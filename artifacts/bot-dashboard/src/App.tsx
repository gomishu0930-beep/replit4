import { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = "";

interface Schedule {
  time: string;
  type: string;
  label: string;
}

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
  schedule: Schedule[];
  stats: Stats;
}

interface ExternalPattern {
  tweetId: string;
  text: string;
  authorId: string;
  like_count: number;
  retweet_count: number;
  bookmark_count: number;
  score: number;
  source: string;
  savedAt: string;
}

interface ExternalInfo {
  count: number;
  lastRefreshedAt: string | null;
  queries: string[];
  topPatterns: ExternalPattern[];
}

interface Post {
  tweetId: string;
  type: string;
  text: string;
  item: { id: string; title: string; affiliateURL: string };
  postedAt: string;
  metrics: {
    like_count: number;
    retweet_count: number;
    reply_count?: number;
    bookmark_count?: number;
  } | null;
}

function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}時間 ${m}分`;
  if (m > 0) return `${m}分 ${s}秒`;
  return `${s}秒`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });
}

function typeLabel(type: string) {
  const map: Record<string, string> = {
    amateur: "素人",
    rank: "ランキング",
    sale: "セール",
    buzz: "バズ",
    random: "ランダム",
    external: "外部収集",
  };
  return map[type] ?? type;
}

function typeBadgeClass(type: string) {
  const map: Record<string, string> = {
    amateur: "bg-rose-500/20 text-rose-300 border-rose-500/30",
    rank: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    sale: "bg-green-500/20 text-green-300 border-green-500/30",
    buzz: "bg-pink-500/20 text-pink-300 border-pink-500/30",
    random: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    external: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  };
  return map[type] ?? "bg-gray-500/20 text-gray-300 border-gray-500/30";
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function Dashboard() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const { data: status, isLoading: loadingStatus } = useQuery<BotStatus>({
    queryKey: ["botStatus", tick],
    queryFn: async () => {
      const res = await fetch(`${API}/api/bot/status`);
      if (!res.ok) throw new Error("Failed to fetch status");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: postsData, isLoading: loadingPosts } = useQuery<{ posts: Post[] }>({
    queryKey: ["botPosts", tick],
    queryFn: async () => {
      const res = await fetch(`${API}/api/bot/posts`);
      if (!res.ok) throw new Error("Failed to fetch posts");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: externalInfo } = useQuery<ExternalInfo>({
    queryKey: ["externalPatterns", tick],
    queryFn: async () => {
      const res = await fetch(`${API}/api/bot/external-patterns`);
      if (!res.ok) throw new Error("Failed to fetch external patterns");
      return res.json();
    },
    refetchInterval: 300000,
  });

  const posts = postsData?.posts ?? [];
  const stats = status?.stats;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-2xl">🔞</div>
            <div>
              <h1 className="text-lg font-bold leading-tight">FANZA X Bot</h1>
              <p className="text-xs text-muted-foreground">
                {status?.account ?? "@ero_senpai1"} • 自動投稿ダッシュボード
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
            <span className="text-xs text-green-400 font-medium">稼働中</span>
            {status && (
              <span className="text-xs text-muted-foreground ml-1">
                {formatUptime(status.uptime)}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Stats */}
        {loadingStatus ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-pulse">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-card border border-border" />
            ))}
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="総投稿数" value={stats.totalPosts} sub="全期間" />
            <StatCard label="今週の投稿" value={stats.postsLast7Days} sub="過去7日間" />
            <StatCard label="累計いいね" value={stats.totalLikes.toLocaleString()} />
            <StatCard label="累計RT" value={stats.totalRetweets.toLocaleString()} />
          </div>
        ) : null}

        {/* Schedule & Last Post */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Schedule */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider">
              投稿スケジュール
            </h2>
            <div className="space-y-2">
              {(status?.schedule ?? [
                { time: "12:00 JST", type: "rank", label: "ランキング" },
                { time: "15:00 JST", type: "sale", label: "セール" },
                { time: "18:00 JST", type: "buzz", label: "バズ + 指標更新" },
                { time: "21:00 JST", type: "random", label: "ランダム" },
                { time: "23:00 JST", type: "sale", label: "セール" },
              ]).map((s) => (
                <div key={s.time} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <span className="text-sm font-mono text-primary">{s.time}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${typeBadgeClass(s.type)}`}>
                      {s.label}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Last post info */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider">
              最新投稿情報
            </h2>
            {stats?.lastPostedAt ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">投稿日時</p>
                  <p className="text-sm font-medium">{formatDate(stats.lastPostedAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">作品タイトル</p>
                  <p className="text-sm font-medium line-clamp-2">{stats.lastPostTitle}</p>
                </div>
                <a
                  href={`https://twitter.com/${(status?.account ?? "@ero_senpai1").replace("@", "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline mt-2"
                >
                  🐦 Xでアカウントを見る →
                </a>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">まだ投稿がありません</p>
            )}
          </div>
        </div>

        {/* Recent posts */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider">
            最近の投稿履歴
          </h2>
          {loadingPosts ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 rounded-lg bg-secondary/50 animate-pulse" />
              ))}
            </div>
          ) : posts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              投稿履歴がありません。<br />
              次の投稿時間までお待ちください 🕐
            </p>
          ) : (
            <div className="space-y-3">
              {posts.map((post) => (
                <div key={post.tweetId} className="flex gap-3 p-3 rounded-lg bg-secondary/30 border border-border/40">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full border ${typeBadgeClass(post.type)}`}>
                        {typeLabel(post.type)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(post.postedAt)}
                      </span>
                    </div>
                    <p className="text-xs text-foreground/80 line-clamp-2">{post.item.title}</p>
                    {post.metrics && (
                      <div className="flex gap-3 mt-1.5 text-xs text-muted-foreground">
                        <span>❤ {post.metrics.like_count}</span>
                        <span>🔁 {post.metrics.retweet_count}</span>
                        {post.metrics.bookmark_count != null && (
                          <span>🔖 {post.metrics.bookmark_count}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <a
                    href={`https://twitter.com/i/web/status/${post.tweetId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline shrink-0 mt-1"
                  >
                    Xで見る →
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* External Patterns */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              外部パターン（他アカウント参考）
            </h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full">
                {externalInfo?.count ?? 0} 件保存済
              </span>
              {externalInfo?.lastRefreshedAt && (
                <span>最終収集: {formatDate(externalInfo.lastRefreshedAt)}</span>
              )}
            </div>
          </div>

          {externalInfo?.queries && externalInfo.queries.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              <span className="text-xs text-muted-foreground">収集クエリ:</span>
              {externalInfo.queries.map((q) => (
                <span key={q} className="text-xs bg-secondary/60 border border-border/50 px-2 py-0.5 rounded-full">
                  {q}
                </span>
              ))}
            </div>
          )}

          {!externalInfo || externalInfo.topPatterns.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              まだデータがありません。<br />
              毎日 6:00 JST に自動収集されます 🔍
            </p>
          ) : (
            <div className="space-y-2">
              {externalInfo.topPatterns.slice(0, 5).map((p, i) => (
                <div key={p.tweetId} className="p-3 rounded-lg bg-secondary/30 border border-border/40">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-blue-400 font-mono">#{i + 1} スコア {p.score}</span>
                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <span>❤ {p.like_count}</span>
                      <span>🔁 {p.retweet_count}</span>
                      {p.bookmark_count > 0 && <span>🔖 {p.bookmark_count}</span>}
                    </div>
                  </div>
                  <p className="text-xs text-foreground/70 line-clamp-3 whitespace-pre-wrap">{p.text}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-muted-foreground/60">クエリ: {p.source}</span>
                    <a
                      href={`https://twitter.com/i/web/status/${p.tweetId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      Xで見る →
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-border mt-8 py-4 text-center text-xs text-muted-foreground">
        FANZA X Bot — 毎日 6回自動稼働中 🤖
      </footer>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={BASE}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
