import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, BookOpen, CheckCircle2, ChevronDown, ClipboardCheck,
  Database, Eye, EyeOff, FileText, Film, HelpCircle, History, Home, Loader2,
  Play, Search, Settings, ShieldCheck, SkipForward, SlidersHorizontal, Trash2,
  XCircle,
} from "lucide-react";

const API = "";

type OpsView =
  | "dashboard"
  | "products"
  | "queue"
  | "dryrun"
  | "videos"
  | "posts"
  | "exclusions"
  | "settings"
  | "rules"
  | "help";

type Tone = "success" | "warning" | "danger" | "info" | "muted";

interface QueueItem {
  id: string;
  type: string;
  status: string;
  text: string;
  affiliateUrl?: string;
  itemTitle?: string;
  mediaFiles?: Array<{ filename: string; url?: string; type: string }>;
  filterResult?: { safe: boolean; reason?: string };
  error?: string;
  createdAt: string;
  updatedAt: string;
  tweetId?: string;
}

interface FanzaItem {
  content_id: string;
  title: string;
  affiliateURL?: string;
  actress: string[];
  genre: string[];
  reviewCount: number;
  reviewAvg: number | null;
  thumbnail: string | null;
  sampleMovieUrl?: string | null;
  makers?: string[];
  sampleVideoAllowed?: { allowed: boolean; reason: string; makers: string[]; allowedMakers: string[] };
  revenueScore?: { score: number; impressionBoost?: number; reasons: string[] };
}

function apiGet<T>(url: string): Promise<T> {
  return fetch(`${API}${url}`).then(async (res) => {
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error ?? "APIエラー");
    return data as T;
  });
}

function toneClass(tone: Tone): string {
  return {
    success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
    warning: "border-amber-500/25 bg-amber-500/10 text-amber-200",
    danger: "border-red-500/25 bg-red-500/10 text-red-200",
    info: "border-blue-500/25 bg-blue-500/10 text-blue-200",
    muted: "border-white/10 bg-white/[0.04] text-zinc-300",
  }[tone];
}

function maskText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***")
    .replace(/(token|secret|key|api_id|affiliate_id)=([^&\s]+)/gi, "$1=***");
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-bold ${toneClass(ok ? "success" : "danger")}`}>{label}</span>;
}

function Badge({ tone = "muted", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold ${toneClass(tone)}`}>{children}</span>;
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-white/10 bg-[#101720] p-4 ${className}`}>{children}</section>;
}

function SectionTitle({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.06] text-blue-200">{icon}</div>
      <div className="min-w-0">
        <h2 className="text-[15px] font-black text-white">{title}</h2>
        {sub && <p className="text-[11px] text-zinc-500">{sub}</p>}
      </div>
    </div>
  );
}

function StatCard({ label, value, tone = "muted", sub }: { label: string; value: string | number; tone?: Tone; sub?: string }) {
  return (
    <Card className="min-h-[92px]">
      <p className="text-[11px] font-semibold text-zinc-500">{label}</p>
      <p className={`mt-2 text-[24px] font-black ${tone === "success" ? "text-emerald-300" : tone === "warning" ? "text-amber-300" : tone === "danger" ? "text-red-300" : tone === "info" ? "text-blue-300" : "text-white"}`}>{value}</p>
      {sub && <p className="mt-1 text-[10px] text-zinc-500">{sub}</p>}
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-white/10 bg-black/20 p-6 text-center text-[12px] text-zinc-500">{text}</div>;
}

function LoadingState() {
  return <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 p-4 text-[12px] text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> 読み込み中...</div>;
}

function ErrorState({ error }: { error: unknown }) {
  return <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-[12px] text-red-200">{maskText(String(error instanceof Error ? error.message : error))}</div>;
}

function ConfirmDialog({
  open, title, children, confirmLabel, danger, onCancel, onConfirm,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4">
      <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-lg border border-white/10 bg-[#101720] p-5 shadow-2xl">
        <h3 className="text-[16px] font-black text-white">{title}</h3>
        <div className="mt-3 text-[12px] leading-relaxed text-zinc-300">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-[12px] font-bold text-zinc-300">キャンセル</button>
          <button onClick={onConfirm} className={`rounded-lg border px-4 py-2 text-[12px] font-bold ${danger ? toneClass("danger") : toneClass("success")}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function BlurRevealImage({ src, alt }: { src?: string | null; alt: string }) {
  const [revealed, setRevealed] = useState(false);
  if (!src) return <div className="grid h-24 w-20 place-items-center rounded-lg bg-black/30 text-[10px] text-zinc-600">画像なし</div>;
  return (
    <div className="relative h-24 w-20 overflow-hidden rounded-lg bg-black/30">
      <img src={src} alt={alt} className={`h-full w-full object-cover transition ${revealed ? "" : "blur-md scale-105 opacity-70"}`} />
      <button
        aria-label={revealed ? "サムネイルをぼかす" : "サムネイルを表示する"}
        onClick={(e) => { e.stopPropagation(); setRevealed((v) => !v); }}
        className="absolute inset-x-1 bottom-1 rounded bg-black/70 px-1 py-1 text-[9px] font-bold text-white"
      >
        {revealed ? "隠す" : "表示"}
      </button>
    </div>
  );
}

function VideoPreview({ files }: { files?: QueueItem["mediaFiles"] }) {
  const file = files?.find((m) => m.type?.includes("video"));
  const [revealed, setRevealed] = useState(false);
  if (!file?.url) return <EmptyState text="動画ファイルはまだありません。" />;
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="truncate text-[11px] text-zinc-400">{file.filename}</p>
        <button onClick={() => setRevealed((v) => !v)} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10px] text-zinc-300">
          {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />} {revealed ? "ぼかす" : "表示する"}
        </button>
      </div>
      <video src={file.url} controls={revealed} className={`max-h-72 w-full rounded bg-black ${revealed ? "" : "blur-md opacity-60"}`} />
    </div>
  );
}

const navItems: Array<{ key: OpsView; label: string; icon: ReactNode }> = [
  { key: "dashboard", label: "ダッシュボード", icon: <Home className="h-4 w-4" /> },
  { key: "products", label: "商品検索", icon: <Search className="h-4 w-4" /> },
  { key: "queue", label: "投稿キュー", icon: <ClipboardCheck className="h-4 w-4" /> },
  { key: "dryrun", label: "dry-run確認", icon: <ShieldCheck className="h-4 w-4" /> },
  { key: "videos", label: "動画確認", icon: <Film className="h-4 w-4" /> },
  { key: "posts", label: "投稿ログ", icon: <History className="h-4 w-4" /> },
  { key: "exclusions", label: "除外ログ", icon: <AlertTriangle className="h-4 w-4" /> },
  { key: "settings", label: "設定状態", icon: <Settings className="h-4 w-4" /> },
  { key: "rules", label: "許可/NG管理", icon: <SlidersHorizontal className="h-4 w-4" /> },
  { key: "help", label: "ヘルプ", icon: <HelpCircle className="h-4 w-4" /> },
];

export default function OpsConsole() {
  const [view, setView] = useState<OpsView>("dashboard");
  const [confirm, setConfirm] = useState<{ title: string; body: React.ReactNode; label: string; danger?: boolean; action: () => Promise<void> | void } | null>(null);
  const dashboard = useQuery<any>({ queryKey: ["opsDashboard"], queryFn: () => apiGet("/api/ops/dashboard"), refetchInterval: 20000 });
  const settings = useQuery<any>({ queryKey: ["opsSettings"], queryFn: () => apiGet("/api/ops/settings/status"), refetchInterval: 30000 });
  const queue = useQuery<any>({ queryKey: ["opsQueue"], queryFn: () => apiGet("/api/bot/queue"), refetchInterval: 15000 });
  const posts = useQuery<any>({ queryKey: ["opsPosts"], queryFn: () => apiGet("/api/ops/logs/posts"), enabled: view === "posts" });
  const exclusions = useQuery<any>({ queryKey: ["opsExclusions"], queryFn: () => apiGet("/api/ops/logs/exclusions"), enabled: view === "exclusions" || view === "dashboard" });
  const allowedMakers = useQuery<any>({ queryKey: ["allowedMakers"], queryFn: () => apiGet("/api/ops/config/allowed-makers"), enabled: view === "rules" || view === "settings" });
  const ngKeywords = useQuery<any>({ queryKey: ["ngKeywords"], queryFn: () => apiGet("/api/ops/config/ng-keywords"), enabled: view === "rules" || view === "settings" });
  const [selectedQueueId, setSelectedQueueId] = useState<string>("");

  const runConfig = settings.data?.runtime;
  const canPost = Boolean(runConfig?.POST_ENABLED && !runConfig?.DRY_RUN);
  const selectedQueue = useMemo(() => (queue.data?.items ?? []).find((item: QueueItem) => item.id === selectedQueueId) ?? (queue.data?.items ?? [])[0], [queue.data, selectedQueueId]);

  const refreshAll = async () => {
    await Promise.all([dashboard.refetch(), settings.refetch(), queue.refetch(), posts.refetch(), exclusions.refetch()]);
  };

  const postQueueItem = async (item: QueueItem) => {
    const res = await fetch(`${API}/api/bot/queue/${item.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manualDirect: true, source: "dashboard" }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error ?? "投稿に失敗しました");
    await refreshAll();
  };

  const skipQueueItem = async (item: QueueItem) => {
    const res = await fetch(`${API}/api/ops/queue/${item.id}/skip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "UI skip" }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error ?? "スキップに失敗しました");
    await refreshAll();
  };

  return (
    <div className="min-h-screen bg-[#070b12] text-white">
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title ?? ""}
        confirmLabel={confirm?.label ?? "実行"}
        danger={confirm?.danger}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const action = confirm?.action;
          setConfirm(null);
          Promise.resolve(action?.()).catch((e) => alert(maskText(e.message)));
        }}
      >
        {confirm?.body}
      </ConfirmDialog>

      <div className="lg:grid lg:grid-cols-[240px_1fr]">
        <aside className="sticky top-0 z-40 border-b border-white/10 bg-[#0b111a]/95 backdrop-blur lg:h-screen lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between p-4 lg:block">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-blue-300">FANZA X Ops</p>
              <h1 className="mt-1 text-[18px] font-black text-white">運用管理</h1>
            </div>
            <a href="/legacy" className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-zinc-400 lg:mt-3 lg:inline-block">旧UI</a>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:space-y-1 lg:overflow-visible">
            {navItems.map((item) => (
              <button
                key={item.key}
                onClick={() => setView(item.key)}
                className={`flex min-h-[40px] shrink-0 items-center gap-2 rounded-lg border px-3 text-[12px] font-bold transition lg:w-full ${view === item.key ? "border-blue-500/30 bg-blue-500/15 text-blue-200" : "border-transparent text-zinc-400 hover:bg-white/[0.05] hover:text-white"}`}
              >
                {item.icon}{item.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 p-4 lg:p-6">
          <header className="mb-4 flex flex-col gap-3 rounded-lg border border-white/10 bg-[#101720] p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">現在の運用状態</p>
              <h2 className="mt-1 text-[22px] font-black text-white">{navItems.find((n) => n.key === view)?.label}</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge ok={settings.data?.secrets?.fanzaApiId} label={`FANZA API ${settings.data?.secrets?.fanzaApiId ? "設定済み" : "未設定"}`} />
              <StatusBadge ok={settings.data?.secrets?.xAccessToken} label={`X連携 ${settings.data?.secrets?.xAccessToken ? "設定済み" : "未設定"}`} />
              <Badge tone={runConfig?.POST_ENABLED ? "success" : "warning"}>POST_ENABLED={String(Boolean(runConfig?.POST_ENABLED))}</Badge>
              <Badge tone={runConfig?.DRY_RUN ? "info" : "warning"}>DRY_RUN={String(Boolean(runConfig?.DRY_RUN))}</Badge>
            </div>
          </header>

          {view === "dashboard" && (
            <DashboardView dashboard={dashboard} queue={queue} settings={settings} exclusions={exclusions} />
          )}
          {view === "products" && <ProductsView />}
          {view === "queue" && (
            <QueueView
              items={queue.data?.items ?? []}
              loading={queue.isLoading}
              error={queue.error}
              canPost={canPost}
              onDryRun={(item) => { setSelectedQueueId(item.id); setView("dryrun"); }}
              onSkip={(item) => setConfirm({ title: "キューをスキップしますか？", label: "スキップする", danger: true, body: <p>{item.itemTitle ?? item.type} を投稿対象から外します。</p>, action: () => skipQueueItem(item) })}
              onPost={(item) => setConfirm({
                title: "本番投稿の確認",
                label: "本番投稿する",
                danger: true,
                body: <PostConfirmBody item={item} />,
                action: () => postQueueItem(item),
              })}
            />
          )}
          {view === "dryrun" && <DryRunView item={selectedQueue} canPost={canPost} disabledReasons={[!runConfig?.POST_ENABLED ? "POST_ENABLED=false" : "", runConfig?.DRY_RUN ? "DRY_RUN=true" : ""].filter(Boolean)} onPost={(item) => setConfirm({ title: "本番投稿の確認", label: "本番投稿する", danger: true, body: <PostConfirmBody item={item} />, action: () => postQueueItem(item) })} />}
          {view === "videos" && <VideosView items={queue.data?.items ?? []} />}
          {view === "posts" && <PostsView query={posts} />}
          {view === "exclusions" && <ExclusionsView query={exclusions} />}
          {view === "settings" && <SettingsView query={settings} allowed={allowedMakers} ng={ngKeywords} />}
          {view === "rules" && <RulesView allowed={allowedMakers} ng={ngKeywords} />}
          {view === "help" && <HelpView />}
        </main>
      </div>
    </div>
  );
}

function DashboardView({ dashboard, queue, settings, exclusions }: { dashboard: any; queue: any; settings: any; exclusions: any }) {
  if (dashboard.isLoading || queue.isLoading) return <LoadingState />;
  if (dashboard.error) return <ErrorState error={dashboard.error} />;
  const stats = queue.data?.stats ?? dashboard.data?.queue?.stats ?? {};
  const safety = dashboard.data?.safety;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
        <StatCard label="本日予定" value={safety?.dailyPostLimit ?? "-"} tone="info" />
        <StatCard label="投稿済み" value={safety?.todayPostCount ?? 0} tone="success" />
        <StatCard label="キュー残" value={stats.pending ?? 0} tone="warning" />
        <StatCard label="dry-run済" value={stats.dry_run ?? 0} tone="info" />
        <StatCard label="エラー" value={stats.failed ?? 0} tone={(stats.failed ?? 0) > 0 ? "danger" : "muted"} />
        <StatCard label="除外" value={dashboard.data?.exclusions?.length ?? 0} tone="warning" />
        <StatCard label="動画候補" value={dashboard.data?.sampleVideoCandidates ?? 0} tone="success" />
        <StatCard label="リスク" value={safety?.riskScore ?? 0} tone={(safety?.riskScore ?? 0) > 60 ? "danger" : "muted"} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <SectionTitle icon={<ClipboardCheck className="h-4 w-4" />} title="直近の投稿候補" sub="毎日の確認はここから始めます" />
          <QueueMiniList items={dashboard.data?.queue?.recent ?? []} />
        </Card>
        <Card>
          <SectionTitle icon={<Activity className="h-4 w-4" />} title="接続状態" sub="Secret値は表示しません" />
          <div className="grid gap-2">
            <StatusBadge ok={dashboard.data?.integrations?.fanza?.apiConfigured} label="FANZA API" />
            <StatusBadge ok={dashboard.data?.integrations?.fanza?.affiliateConfigured} label="FANZA Affiliate" />
            <StatusBadge ok={dashboard.data?.integrations?.x?.ok} label="X API" />
            <StatusBadge ok={dashboard.data?.integrations?.sampleVideo?.ffmpegAvailable} label="ffmpeg" />
            <Badge tone={settings.data?.runtime?.DRY_RUN ? "info" : "warning"}>dry-run優先: {String(settings.data?.runtime?.DRY_RUN)}</Badge>
          </div>
        </Card>
      </div>
      <Card>
        <SectionTitle icon={<AlertTriangle className="h-4 w-4" />} title="直近の失敗・除外理由" />
        {exclusions.data?.rows?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-[12px]">
              <tbody>{exclusions.data.rows.slice(0, 8).map((row: any) => <tr key={row.id} className="border-t border-white/5"><td className="py-2 text-zinc-300">{row.title}</td><td className="py-2 text-amber-200">{row.reason}</td><td className="py-2 text-zinc-500">{new Date(row.updatedAt).toLocaleString("ja-JP")}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <EmptyState text="直近の除外ログはありません。" />}
      </Card>
    </div>
  );
}

function QueueMiniList({ items }: { items: QueueItem[] }) {
  if (!items.length) return <EmptyState text="キューは空です。" />;
  return <div className="space-y-2">{items.map((item) => <div key={item.id} className="rounded-lg border border-white/8 bg-black/20 p-3"><div className="flex items-center gap-2"><Badge tone={item.status === "failed" ? "danger" : item.status === "posted" ? "success" : "info"}>{item.status}</Badge><p className="min-w-0 flex-1 truncate text-[12px] text-white">{item.itemTitle ?? item.type}</p></div><p className="mt-1 line-clamp-2 text-[11px] text-zinc-500">{item.text}</p></div>)}</div>;
}

function ProductsView() {
  const [keyword, setKeyword] = useState("");
  const [type, setType] = useState("revenue");
  const [items, setItems] = useState<FanzaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const search = async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ type, count: "10" });
      if (keyword.trim()) params.set("keyword", keyword.trim());
      const data = await apiGet<{ items: FanzaItem[] }>(`/api/bot/fanza-search?${params}`);
      setItems(data.items ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle icon={<Search className="h-4 w-4" />} title="商品検索・候補取得" sub="サムネイルは初期状態でぼかします" />
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_160px]">
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="キーワード、ジャンル、女優名" className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[13px] outline-none focus:border-blue-500/50" />
          <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[13px]">
            <option value="revenue">インプ期待/収益候補</option><option value="rank">ランキング</option><option value="sale">セール</option><option value="buzz">バズ</option><option value="keyword">キーワード</option>
          </select>
          <button onClick={search} className={`rounded-lg border px-3 py-2 text-[13px] font-bold ${toneClass("success")}`}>{loading ? "検索中..." : "dry-run検索"}</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2"><Badge tone="info">サンプル動画あり優先</Badge><Badge tone="info">許可メーカー判定表示</Badge><Badge tone="warning">NGキーワード除外はサーバー側で確認</Badge></div>
      </Card>
      {error && <ErrorState error={error} />}
      {loading && <LoadingState />}
      <div className="grid gap-3 xl:grid-cols-2">
        {items.map((item) => <ProductCard key={item.content_id} item={item} />)}
      </div>
      {!loading && !items.length && <EmptyState text="検索すると投稿候補が表示されます。" />}
    </div>
  );
}

function ProductCard({ item }: { item: FanzaItem }) {
  const exclusion = [
    !item.sampleMovieUrl ? "サンプル動画なし" : "",
    !item.affiliateURL ? "アフィリエイトURLなし" : "",
    item.sampleVideoAllowed && !item.sampleVideoAllowed.allowed ? item.sampleVideoAllowed.reason : "",
  ].filter(Boolean);
  return (
    <Card>
      <div className="flex gap-3">
        <BlurRevealImage src={item.thumbnail} alt={item.title} />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-[13px] font-bold text-white">{item.title}</h3>
          <p className="mt-1 truncate text-[11px] text-zinc-500">{item.content_id}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={item.sampleMovieUrl ? "success" : "danger"}>動画{item.sampleMovieUrl ? "あり" : "なし"}</Badge>
            <Badge tone={item.affiliateURL ? "success" : "danger"}>URL{item.affiliateURL ? "あり" : "なし"}</Badge>
            <Badge tone={item.sampleVideoAllowed?.allowed ? "success" : "warning"}>{item.sampleVideoAllowed?.reason ?? "メーカー未判定"}</Badge>
            {item.revenueScore && <Badge tone="info">期待{item.revenueScore.score}</Badge>}
          </div>
          <p className="mt-2 line-clamp-1 text-[11px] text-zinc-500">{item.revenueScore?.reasons?.join(" / ") || item.genre?.join(" / ")}</p>
          {exclusion.length > 0 && <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-[11px] text-amber-200">除外理由: {exclusion.join(" / ")}</div>}
        </div>
      </div>
    </Card>
  );
}

function QueueView({ items, loading, error, canPost, onDryRun, onSkip, onPost }: { items: QueueItem[]; loading: boolean; error: unknown; canPost: boolean; onDryRun: (item: QueueItem) => void; onSkip: (item: QueueItem) => void; onPost: (item: QueueItem) => void }) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;
  if (!items.length) return <EmptyState text="投稿キューは空です。" />;
  return (
    <Card>
      <SectionTitle icon={<ClipboardCheck className="h-4 w-4" />} title="投稿キュー管理" sub="本番投稿は必ず確認モーダルを挟みます" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-[12px]">
          <thead className="text-zinc-500"><tr><th className="p-2">状態</th><th className="p-2">タイトル</th><th className="p-2">投稿文</th><th className="p-2">動画</th><th className="p-2">作成</th><th className="p-2">操作</th></tr></thead>
          <tbody>{items.map((item) => (
            <tr key={item.id} className="border-t border-white/5 align-top">
              <td className="p-2"><Badge tone={item.status === "failed" ? "danger" : item.status === "posted" ? "success" : item.status === "dry_run" ? "info" : "warning"}>{item.status}</Badge></td>
              <td className="max-w-[220px] p-2 text-white"><p className="line-clamp-2">{item.itemTitle ?? item.type}</p><p className="mt-1 text-[10px] text-zinc-600">{item.id.slice(0, 8)}</p></td>
              <td className="max-w-[340px] p-2 text-zinc-400"><p className="line-clamp-3">{item.text}</p>{item.affiliateUrl && <p className="mt-1 truncate text-blue-300">{item.affiliateUrl}</p>}</td>
              <td className="p-2">{item.mediaFiles?.length ? <Badge tone="success">あり</Badge> : <Badge tone="muted">なし</Badge>}</td>
              <td className="p-2 text-zinc-500">{new Date(item.createdAt).toLocaleString("ja-JP")}</td>
              <td className="p-2"><div className="flex flex-wrap gap-2"><button onClick={() => onDryRun(item)} className={`rounded-md border px-2 py-1 text-[11px] font-bold ${toneClass("info")}`}>dry-runで投稿確認</button><button disabled={!canPost} onClick={() => onPost(item)} className={`rounded-md border px-2 py-1 text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${toneClass(canPost ? "danger" : "muted")}`}>次の1件を投稿</button><button onClick={() => onSkip(item)} className={`rounded-md border px-2 py-1 text-[11px] font-bold ${toneClass("warning")}`}>スキップ</button></div></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Card>
  );
}

function PostConfirmBody({ item }: { item: QueueItem }) {
  return <div className="space-y-2"><p className="font-bold text-red-200">本番投稿します。取り消せません。</p><p>投稿タイトル: {item.itemTitle ?? item.type}</p><p className="rounded bg-black/30 p-2">{item.text}</p><p className="break-all text-blue-200">{item.affiliateUrl ?? "アフィリエイトURLなし"}</p><p>添付動画: {item.mediaFiles?.some((m) => m.type.includes("video")) ? "あり" : "なし"}</p></div>;
}

function DryRunView({ item, canPost, disabledReasons, onPost }: { item?: QueueItem; canPost: boolean; disabledReasons: string[]; onPost: (item: QueueItem) => void }) {
  if (!item) return <EmptyState text="確認するキューを選択してください。" />;
  const issues = [...disabledReasons, item.filterResult?.safe === false ? item.filterResult.reason ?? "Compliance NG" : ""].filter(Boolean);
  return <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]"><Card><SectionTitle icon={<ShieldCheck className="h-4 w-4" />} title="dry-run確認" sub="投稿事故を防ぐ最終確認" /><div className={`mb-3 rounded-lg border p-3 text-[13px] font-black ${issues.length ? toneClass("danger") : toneClass("success")}`}>{issues.length ? "この内容では本番投稿できません" : "この内容で本番投稿可能です"}</div><p className="whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-[13px] text-zinc-200">{item.text}</p><p className="mt-3 break-all text-[12px] text-blue-300">{item.affiliateUrl}</p><div className="mt-3 flex flex-wrap gap-2"><Badge tone={item.filterResult?.safe === false ? "danger" : "success"}>Compliance {item.filterResult?.safe === false ? "NG" : "OK"}</Badge><Badge tone={canPost ? "success" : "danger"}>X投稿可能 {canPost ? "OK" : "NG"}</Badge></div>{issues.length > 0 && <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-[12px] text-red-200">{issues.join(" / ")}</div>}<button disabled={!canPost || issues.length > 0} onClick={() => onPost(item)} className={`mt-4 rounded-lg border px-4 py-2 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${toneClass("danger")}`}>本番投稿へ進む</button></Card><Card><SectionTitle icon={<Film className="h-4 w-4" />} title="添付予定動画" /><VideoPreview files={item.mediaFiles} /></Card></div>;
}

function VideosView({ items }: { items: QueueItem[] }) {
  const videoItems = items.filter((item) => item.mediaFiles?.length);
  return <Card><SectionTitle icon={<Film className="h-4 w-4" />} title="動画確認・処理状況" sub="禁止加工の操作ボタンはありません" />{videoItems.length ? <div className="grid gap-4 xl:grid-cols-2">{videoItems.map((item) => <div key={item.id} className="rounded-lg border border-white/8 bg-black/20 p-3"><p className="mb-2 text-[12px] font-bold text-white">{item.itemTitle ?? item.type}</p><VideoPreview files={item.mediaFiles} /><div className="mt-2 grid gap-1 text-[11px] text-zinc-500"><p>取得元: 公式/許可済みURLのみ</p><p>変換: trim / scale / pad / mp4</p><p>禁止: テキスト重ね、BGM追加、ロゴ追加、複数シーン結合、モザイク除去</p></div></div>)}</div> : <EmptyState text="動画付きキューはまだありません。" />}</Card>;
}

function PostsView({ query }: { query: any }) {
  const [q, setQ] = useState("");
  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} />;
  const rows = (query.data?.records ?? []).filter((r: any) => `${r.productTitle} ${r.productId} ${r.postId}`.toLowerCase().includes(q.toLowerCase()));
  const csv = () => {
    const body = rows.map((r: any) => [r.postedAt, r.postId, r.productId, r.productTitle, r.result].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([`postedAt,postId,contentId,title,result\n${body}`], { type: "text/csv" })); a.download = "post-logs.csv"; a.click();
  };
  return <Card><SectionTitle icon={<History className="h-4 w-4" />} title="投稿ログ" /><div className="mb-3 flex gap-2"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="content_id、タイトル、tweet_idで検索" className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[13px]" /><button onClick={csv} className={`rounded-lg border px-3 py-2 text-[12px] font-bold ${toneClass("info")}`}>CSVエクスポート</button></div><LogTable rows={rows} /></Card>;
}

function LogTable({ rows }: { rows: any[] }) {
  if (!rows.length) return <EmptyState text="ログはありません。" />;
  return <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-left text-[12px]"><tbody>{rows.slice(0, 200).map((row, idx) => <tr key={`${row.postId}-${idx}`} className="border-t border-white/5"><td className="p-2 text-zinc-500">{row.postedAt ? new Date(row.postedAt).toLocaleString("ja-JP") : "-"}</td><td className="p-2 text-blue-300">{row.postId}</td><td className="p-2 text-zinc-300">{row.productId}</td><td className="max-w-[340px] p-2 text-white"><p className="truncate">{row.productTitle}</p></td><td className="p-2"><Badge tone={row.result === "posted" ? "success" : row.result === "failed" ? "danger" : "info"}>{row.result}</Badge></td><td className="max-w-[360px] p-2 text-zinc-500"><details><summary className="cursor-pointer">本文/詳細</summary><pre className="mt-2 whitespace-pre-wrap rounded bg-black/30 p-2">{maskText(row.text ?? row.error ?? "")}</pre></details></td></tr>)}</tbody></table></div>;
}

function ExclusionsView({ query }: { query: any }) {
  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} />;
  const rows = query.data?.rows ?? [];
  return <div className="space-y-4"><Card><SectionTitle icon={<AlertTriangle className="h-4 w-4" />} title="除外ログ" sub="候補から外れた理由を改善に使います" /><div className="mb-3 flex flex-wrap gap-2">{Object.entries(query.data?.summary?.byReason ?? {}).slice(0, 8).map(([reason, count]) => <Badge key={reason} tone="warning">{reason}: {String(count)}</Badge>)}</div><LogTable rows={rows.map((r: any) => ({ ...r, postId: r.id, productTitle: r.title, productId: r.content_id, postedAt: r.updatedAt, result: r.status, text: r.reason }))} /></Card></div>;
}

function SettingsView({ query, allowed, ng }: { query: any; allowed: any; ng: any }) {
  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} />;
  const s = query.data;
  return <Card><SectionTitle icon={<Settings className="h-4 w-4" />} title="設定状態" sub="APIキーやトークンはReplit Secretsで管理してください。この画面には値は表示されません。" /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(s.secrets ?? {}).map(([key, value]) => <div key={key} className="rounded-lg border border-white/8 bg-black/20 p-3"><p className="text-[11px] text-zinc-500">{key}</p><StatusBadge ok={Boolean(value)} label={value ? "設定済み" : "未設定"} /></div>)}<StatCard label="allowed_makers.json" value={allowed.data?.config?.makers?.length ?? "-"} /><StatCard label="ng_keywords.json" value={ng.data?.config?.keywords?.length ?? "-"} /><StatCard label="MAX_VIDEO_SECONDS" value={s.runtime?.MAX_VIDEO_SECONDS ?? "-"} /><StatCard label="VIDEO_WIDTH" value={s.runtime?.VIDEO_WIDTH ?? "-"} /><StatCard label="VIDEO_HEIGHT" value={s.runtime?.VIDEO_HEIGHT ?? "-"} /></div></Card>;
}

function RulesView({ allowed, ng }: { allowed: any; ng: any }) {
  const [makerName, setMakerName] = useState("");
  const [keyword, setKeyword] = useState("");
  if (allowed.isLoading || ng.isLoading) return <LoadingState />;
  if (allowed.error || ng.error) return <ErrorState error={allowed.error || ng.error} />;
  const makers = allowed.data?.config?.makers ?? [];
  const keywords = ng.data?.config?.keywords ?? [];
  const saveMakers = async (next: any[]) => {
    await fetch(`${API}/api/ops/config/allowed-makers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...allowed.data.config, makers: next } }) });
    await allowed.refetch();
  };
  const saveKeywords = async (next: string[]) => {
    await fetch(`${API}/api/ops/config/ng-keywords`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { keywords: next } }) });
    await ng.refetch();
  };
  return <div className="grid gap-4 xl:grid-cols-2"><Card><SectionTitle icon={<SlidersHorizontal className="h-4 w-4" />} title="許可メーカー" sub="保存時にバックアップを作成します" /><div className="flex gap-2"><input value={makerName} onChange={(e) => setMakerName(e.target.value)} placeholder="メーカー名" className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[13px]" /><button onClick={() => { if (makerName.trim()) { saveMakers([...makers, { name: makerName.trim() }]); setMakerName(""); } }} className={`rounded-lg border px-3 py-2 text-[12px] font-bold ${toneClass("success")}`}>追加</button></div><div className="mt-3 space-y-2">{makers.map((m: any, idx: number) => <div key={`${m.name}-${idx}`} className="flex items-center justify-between rounded-lg bg-black/20 p-2 text-[12px]"><span>{m.name}</span><button onClick={() => saveMakers(makers.filter((_: any, i: number) => i !== idx))} className="text-red-300">削除</button></div>)}</div></Card><Card><SectionTitle icon={<ShieldCheck className="h-4 w-4" />} title="NGキーワード" sub="不正JSONにならないよう配列として保存します" /><div className="flex gap-2"><input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="NGキーワード" className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[13px]" /><button onClick={() => { if (keyword.trim()) { saveKeywords([...keywords, keyword.trim()]); setKeyword(""); } }} className={`rounded-lg border px-3 py-2 text-[12px] font-bold ${toneClass("success")}`}>追加</button></div><div className="mt-3 flex flex-wrap gap-2">{keywords.map((k: string) => <button key={k} onClick={() => saveKeywords(keywords.filter((x: string) => x !== k))} className={`rounded-md border px-2 py-1 text-[11px] ${toneClass("warning")}`}>{k} ×</button>)}</div><details className="mt-4"><summary className="cursor-pointer text-[12px] text-zinc-400">保存前プレビュー</summary><pre className="mt-2 max-h-72 overflow-auto rounded bg-black/30 p-3 text-[11px] text-zinc-400">{JSON.stringify({ makers, keywords }, null, 2)}</pre></details></Card></div>;
}

function HelpView() {
  const steps = ["商品検索", "候補確認", "キュー追加", "dry-run", "投稿文確認", "本番投稿", "ログ確認"];
  return <div className="grid gap-4 xl:grid-cols-2"><Card><SectionTitle icon={<BookOpen className="h-4 w-4" />} title="1日の運用フロー" />{steps.map((step, idx) => <div key={step} className="flex items-center gap-3 border-t border-white/5 py-3"><span className="grid h-7 w-7 place-items-center rounded bg-blue-500/15 text-[12px] font-black text-blue-200">{idx + 1}</span><p className="text-[13px] font-bold text-white">{step}</p></div>)}</Card><Card><SectionTitle icon={<AlertTriangle className="h-4 w-4" />} title="本番投稿前チェックリスト" /><ul className="space-y-2 text-[12px] text-zinc-300"><li>POST_ENABLED=true になっている</li><li>DRY_RUN=false になっている</li><li>X側のセンシティブメディア設定を確認済み</li><li>FANZA公式素材または許諾済みURLのみ使用</li><li>PR/広告/アフィリエイト表記が本文にある</li><li>未成年・非同意・権利不明の示唆がない</li></ul><div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-[12px] text-amber-200">APIキーやトークンはReplit Secretsで設定してください。UIには表示されません。</div></Card></div>;
}
