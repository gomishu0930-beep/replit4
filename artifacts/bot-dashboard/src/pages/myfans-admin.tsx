import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const API = "";

type MediaType = "official_preview" | "thumbnail" | "user_owned";
type MyFansStatus = "draft" | "reviewed" | "approved" | "rejected" | "posted";

interface MyFansMedia {
  filename: string;
  url?: string;
  type: MediaType;
  mimeType?: string;
}

interface MyFansItem {
  id: string;
  provider: "myfans";
  creator_name: string;
  source_url: string;
  affiliate_url: string;
  original_text: string;
  generated_caption: string;
  media_files: MyFansMedia[];
  status: MyFansStatus;
  safety_notes: string[];
  queue_id?: string;
  created_at: string;
  updated_at: string;
}

interface FetchJob {
  id: string;
  created_at: string;
  instructions: string;
  target_count: number;
  status: "pending" | "in_progress" | "done";
}

const STATUS_LABEL: Record<MyFansStatus, string> = {
  draft: "下書き",
  reviewed: "確認済",
  approved: "承認済",
  rejected: "拒否",
  posted: "投稿済",
};

const STATUS_COLOR: Record<MyFansStatus, string> = {
  draft: "bg-zinc-600 text-zinc-200",
  reviewed: "bg-blue-900 text-blue-200",
  approved: "bg-green-900 text-green-200",
  rejected: "bg-red-900 text-red-200",
  posted: "bg-purple-900 text-purple-200",
};

const JOB_COLOR: Record<FetchJob["status"], string> = {
  pending: "bg-yellow-900 text-yellow-200",
  in_progress: "bg-blue-900 text-blue-200",
  done: "bg-green-900 text-green-200",
};

export default function MyfansAdmin() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState<MyFansStatus | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [captionStyle, setCaptionStyle] = useState("friend");
  const [ingestJson, setIngestJson] = useState("");
  const [showIngestPanel, setShowIngestPanel] = useState(false);
  const [showJobPanel, setShowJobPanel] = useState(false);
  const [targetCount, setTargetCount] = useState(5);
  const [files, setFiles] = useState<File[]>([]);

  const { data: itemsData, isLoading } = useQuery({
    queryKey: ["myfans-items", statusFilter],
    queryFn: () => {
      const qs = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      return fetch(`${API}/api/myfans/items${qs}`).then((r) => r.json()) as Promise<{
        ok: boolean; items: MyFansItem[]; total: number;
      }>;
    },
    refetchInterval: 15000,
  });

  const { data: jobsData } = useQuery({
    queryKey: ["myfans-jobs"],
    queryFn: () =>
      fetch(`${API}/api/myfans/fetch-jobs`).then((r) => r.json()) as Promise<{
        ok: boolean; jobs: FetchJob[];
      }>,
  });

  const createJobMutation = useMutation({
    mutationFn: () =>
      fetch(`${API}/api/myfans/fetch-job`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_count: targetCount }),
      }).then((r) => r.json()),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["myfans-jobs"] });
      toast({ title: "取得ジョブ作成", description: `ジョブID: ${data.job?.id?.slice(0, 8)}...` });
    },
  });

  const ingestMutation = useMutation({
    mutationFn: async () => {
      let parsed: any;
      try {
        parsed = JSON.parse(ingestJson);
      } catch {
        throw new Error("JSONの形式が正しくありません");
      }

      const fd = new FormData();
      fd.append("data", JSON.stringify(Array.isArray(parsed) ? parsed : [parsed]));
      files.forEach((f) => fd.append("media_files", f));

      return fetch(`${API}/api/myfans/ingest`, { method: "POST", body: fd }).then((r) => r.json());
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["myfans-items"] });
      const created = (data.results ?? []).filter((r: any) => r.created).length;
      const skipped = (data.results ?? []).filter((r: any) => r.skipped).length;
      toast({
        title: "取り込み完了",
        description: `${created}件追加 / ${skipped}件スキップ`,
      });
      setIngestJson("");
      setFiles([]);
      setShowIngestPanel(false);
    },
    onError: (e: Error) => toast({ title: "エラー", description: e.message, variant: "destructive" }),
  });

  const generateCaption = useCallback(
    async (id: string) => {
      setGeneratingId(id);
      try {
        const r = await fetch(`${API}/api/myfans/items/${id}/generate-caption`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ style: captionStyle }),
        });
        const data = await r.json();
        if (data.ok) {
          toast({ title: "投稿文生成完了", description: data.caption?.slice(0, 40) + "..." });
          qc.invalidateQueries({ queryKey: ["myfans-items"] });
        } else {
          toast({ title: "生成失敗", description: data.error, variant: "destructive" });
        }
      } finally {
        setGeneratingId(null);
      }
    },
    [captionStyle, qc, toast],
  );

  const approveItem = useCallback(
    async (id: string) => {
      setApprovingId(id);
      setItemErrors((prev) => ({ ...prev, [id]: "" }));
      try {
        const r = await fetch(`${API}/api/myfans/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = await r.json();
        if (data.ok) {
          toast({ title: "✅ 投稿キューへ追加", description: `queue_id: ${data.queue_item?.id?.slice(0, 8)}…` });
          qc.invalidateQueries({ queryKey: ["myfans-items"] });
        } else {
          const msg = data.error ?? "不明なエラー";
          setItemErrors((prev) => ({ ...prev, [id]: msg }));
          toast({ title: "承認失敗", description: msg, variant: "destructive" });
        }
      } catch (e: any) {
        const msg = e?.message ?? "ネットワークエラー";
        setItemErrors((prev) => ({ ...prev, [id]: msg }));
      } finally {
        setApprovingId(null);
      }
    },
    [qc, toast],
  );

  const updateStatus = useCallback(
    async (id: string, status: MyFansStatus) => {
      await fetch(`${API}/api/myfans/items/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      qc.invalidateQueries({ queryKey: ["myfans-items"] });
    },
    [qc],
  );

  const deleteItem = useCallback(
    async (id: string) => {
      if (!window.confirm("削除しますか?")) return;
      await fetch(`${API}/api/myfans/items/${id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["myfans-items"] });
      if (expandedId === id) setExpandedId(null);
    },
    [qc, expandedId],
  );

  const items = itemsData?.items ?? [];
  const jobs = jobsData?.jobs ?? [];

  const statusCounts = ["draft", "reviewed", "approved", "rejected", "posted"].reduce(
    (acc, s) => ({ ...acc, [s]: (itemsData?.items ?? []).filter((i) => i.status === s).length }),
    {} as Record<string, number>,
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 pb-20">
      {/* ヘッダー */}
      <div className="sticky top-0 z-20 bg-zinc-950/95 backdrop-blur border-b border-white/10 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold">MyFans 管理</span>
          <span className="text-[11px] text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">
            計 {itemsData?.total ?? 0}件
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowJobPanel(!showJobPanel); setShowIngestPanel(false); }}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-blue-900/40 text-blue-300 border border-blue-800/50 hover:bg-blue-900/60 transition-all"
          >
            📋 取得ジョブ作成
          </button>
          <button
            onClick={() => { setShowIngestPanel(!showIngestPanel); setShowJobPanel(false); }}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-violet-900/40 text-violet-300 border border-violet-800/50 hover:bg-violet-900/60 transition-all"
          >
            📥 取り込み
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">

        {/* 取得ジョブパネル */}
        {showJobPanel && (
          <div className="rounded-xl border border-blue-800/40 bg-zinc-900 p-4 space-y-3">
            <p className="text-[13px] font-semibold text-blue-300">📋 Computer Use 向け取得ジョブ</p>
            <div className="flex items-center gap-2">
              <label className="text-[12px] text-zinc-400">取得件数</label>
              <input
                type="number"
                min={1} max={20}
                value={targetCount}
                onChange={(e) => setTargetCount(Number(e.target.value))}
                className="w-16 bg-zinc-800 text-zinc-100 text-[12px] rounded px-2 py-1 border border-white/10"
              />
              <button
                onClick={() => createJobMutation.mutate()}
                disabled={createJobMutation.isPending}
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-blue-800 text-blue-100 hover:bg-blue-700 disabled:opacity-50 transition-all"
              >
                {createJobMutation.isPending ? "作成中..." : "ジョブ作成"}
              </button>
            </div>
            {jobs.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {jobs.slice(0, 5).map((j) => (
                  <div key={j.id} className="rounded-lg bg-zinc-800 p-3 text-[11px] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-zinc-400">{j.id.slice(0, 8)}…</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] ${JOB_COLOR[j.status]}`}>
                        {j.status}
                      </span>
                    </div>
                    <p className="text-zinc-500 text-[10px]">
                      {new Date(j.created_at).toLocaleString("ja-JP")} / {j.target_count}件
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 取り込みパネル */}
        {showIngestPanel && (
          <div className="rounded-xl border border-violet-800/40 bg-zinc-900 p-4 space-y-3">
            <p className="text-[13px] font-semibold text-violet-300">📥 JSON取り込み</p>
            <p className="text-[11px] text-zinc-500">
              Computer Use から取得した JSON を貼り付けるか、ファイルアップロードで取り込みます。
            </p>
            <textarea
              value={ingestJson}
              onChange={(e) => setIngestJson(e.target.value)}
              placeholder={`[\n  {\n    "creator_name": "〇〇ちゃん",\n    "source_url": "https://myfans.jp/...",\n    "affiliate_url": "https://...",\n    "original_text": "元の投稿文",\n    "media_files": [{ "filename": "thumb.jpg", "url": "https://...", "type": "thumbnail" }]\n  }\n]`}
              rows={8}
              className="w-full bg-zinc-800 text-zinc-100 text-[11px] font-mono rounded-lg px-3 py-2 border border-white/10 resize-none focus:outline-none focus:border-violet-600"
            />
            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">メディアファイル（任意・official_preview/thumbnail/user_owned のみ）</label>
              <input
                type="file"
                multiple
                accept="image/*,video/mp4,video/quicktime"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                className="text-[11px] text-zinc-400"
              />
              {files.length > 0 && (
                <p className="text-[10px] text-zinc-500 mt-1">{files.length}ファイル選択済み</p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => ingestMutation.mutate()}
                disabled={ingestMutation.isPending || !ingestJson.trim()}
                className="px-4 py-2 rounded-lg text-[12px] font-medium bg-violet-800 text-violet-100 hover:bg-violet-700 disabled:opacity-50 transition-all"
              >
                {ingestMutation.isPending ? "取り込み中..." : "取り込み実行"}
              </button>
              <button
                onClick={() => { setShowIngestPanel(false); setIngestJson(""); setFiles([]); }}
                className="px-4 py-2 rounded-lg text-[12px] font-medium bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition-all"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}

        {/* ステータスフィルター */}
        <div className="flex gap-1.5 flex-wrap">
          {(["all", "draft", "reviewed", "approved", "rejected", "posted"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border ${
                statusFilter === s
                  ? "bg-white text-zinc-900 border-white"
                  : "bg-zinc-800 text-zinc-400 border-white/10 hover:bg-zinc-700"
              }`}
            >
              {s === "all"
                ? `すべて (${itemsData?.total ?? 0})`
                : `${STATUS_LABEL[s]} (${statusCounts[s] ?? 0})`}
            </button>
          ))}
        </div>

        {/* キャプション文体設定 */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-500">文体:</span>
          {[
            { id: "friend", label: "友達口調" },
            { id: "promo", label: "販促" },
            { id: "night", label: "夜向け" },
            { id: "review", label: "レビュー" },
          ].map((s) => (
            <button
              key={s.id}
              onClick={() => setCaptionStyle(s.id)}
              className={`px-2 py-0.5 rounded text-[10px] border transition-all ${
                captionStyle === s.id
                  ? "bg-amber-900/50 text-amber-300 border-amber-800"
                  : "bg-zinc-800 text-zinc-500 border-white/5 hover:bg-zinc-700"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* アイテム一覧 */}
        {isLoading && (
          <div className="text-center py-12 text-zinc-500 text-[13px]">読み込み中...</div>
        )}

        {!isLoading && items.length === 0 && (
          <div className="text-center py-16 text-zinc-600 text-[13px] space-y-2">
            <p className="text-2xl">📭</p>
            <p>まだアイテムがありません</p>
            <p className="text-[11px]">「取得ジョブ作成」→ Computer Use で取得 → 「取り込み」の手順で追加できます</p>
          </div>
        )}

        <div className="space-y-3">
          {items.map((item) => {
            const isExpanded = expandedId === item.id;
            const hasCaption = !!item.generated_caption;
            // reviewed or draft(caption済み) → 承認可能。approved/posted/rejected は再承認不可
            const canApprove =
              (item.status === "reviewed" || item.status === "draft") &&
              hasCaption &&
              !!item.affiliate_url;
            const itemError = itemErrors[item.id] ?? "";

            return (
              <div
                key={item.id}
                className={`rounded-xl border transition-all ${
                  isExpanded ? "border-white/20 bg-zinc-800/80" : "border-white/8 bg-zinc-900 hover:border-white/15"
                }`}
              >
                {/* サマリー行 */}
                <div
                  className="flex items-start gap-3 p-3 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                >
                  {/* メディアサムネイル */}
                  <div className="w-14 h-14 rounded-lg bg-zinc-800 overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {item.media_files.find((m) => m.url) ? (
                      <img
                        src={item.media_files.find((m) => m.url)!.url}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => ((e.target as HTMLImageElement).src = "")}
                      />
                    ) : (
                      <span className="text-zinc-600 text-[18px]">🖼</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-zinc-100 truncate">
                        {item.creator_name || "（名前なし）"}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLOR[item.status]}`}>
                        {STATUS_LABEL[item.status]}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                      {item.affiliate_url || "affiliate_url なし ⚠"}
                    </p>
                    {hasCaption && (
                      <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2 leading-snug">
                        {item.generated_caption}
                      </p>
                    )}
                    {item.safety_notes.length > 0 && (
                      <p className="text-[10px] text-red-400 mt-0.5">
                        ⚠ {item.safety_notes.join(" / ")}
                      </p>
                    )}
                  </div>
                  <span className="text-zinc-600 text-[12px] mt-1">{isExpanded ? "▲" : "▼"}</span>
                </div>

                {/* 展開パネル */}
                {isExpanded && (
                  <div className="border-t border-white/10 px-3 pb-3 space-y-3">

                    {/* 詳細情報 */}
                    <div className="pt-3 space-y-2 text-[11px]">
                      <DetailRow label="source_url" value={item.source_url} isUrl />
                      <DetailRow label="affiliate_url" value={item.affiliate_url} isUrl />
                      <DetailRow label="created" value={new Date(item.created_at).toLocaleString("ja-JP")} />
                      {item.queue_id && (
                        <DetailRow label="queue_id" value={item.queue_id.slice(0, 8) + "…"} />
                      )}
                    </div>

                    {/* 元の投稿文 */}
                    {item.original_text && (
                      <div>
                        <p className="text-[10px] text-zinc-500 mb-1">元の投稿文</p>
                        <p className="text-[11px] text-zinc-300 bg-zinc-800/60 rounded-lg px-3 py-2 whitespace-pre-wrap leading-relaxed">
                          {item.original_text}
                        </p>
                      </div>
                    )}

                    {/* 生成キャプション */}
                    <div>
                      <p className="text-[10px] text-zinc-500 mb-1">X投稿文（generated_caption）</p>
                      {hasCaption ? (
                        <div className="bg-zinc-800/60 rounded-lg px-3 py-2">
                          <p className="text-[12px] text-zinc-100 whitespace-pre-wrap leading-relaxed">
                            {item.generated_caption}
                          </p>
                          <p className="text-[10px] text-zinc-600 mt-1">
                            {item.generated_caption.length}文字
                          </p>
                        </div>
                      ) : (
                        <p className="text-[11px] text-zinc-600 italic">未生成</p>
                      )}
                    </div>

                    {/* メディア一覧 */}
                    {item.media_files.length > 0 && (
                      <div>
                        <p className="text-[10px] text-zinc-500 mb-1">メディアファイル ({item.media_files.length}件)</p>
                        <div className="flex gap-2 flex-wrap">
                          {item.media_files.map((m, idx) => (
                            <div key={idx} className="rounded bg-zinc-800 p-1.5 text-[10px] text-zinc-400">
                              <div className="w-16 h-16 bg-zinc-700 rounded flex items-center justify-center overflow-hidden mb-1">
                                {m.url ? (
                                  <img src={m.url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <span>📁</span>
                                )}
                              </div>
                              <p className="truncate max-w-[64px]">{m.filename || "file"}</p>
                              <p className="text-zinc-600">{m.type}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* キュー連携ステータス */}
                    {item.status === "approved" && item.queue_id && (
                      <div className="rounded-lg bg-green-900/20 border border-green-800/40 px-3 py-2 text-[11px] space-y-0.5">
                        <p className="text-green-300 font-medium">✅ 投稿キュー追加済み</p>
                        <p className="text-zinc-500">
                          queue_id: <span className="font-mono text-zinc-400">{item.queue_id.slice(0, 8)}…</span>
                          　ステータスは <strong>approved</strong> で維持（X投稿後に posted へ更新）
                        </p>
                      </div>
                    )}

                    {/* インラインエラー表示 */}
                    {itemError && (
                      <div className="rounded-lg bg-red-900/20 border border-red-800/40 px-3 py-2 text-[11px] text-red-300">
                        ❌ {itemError}
                      </div>
                    )}

                    {/* アクションボタン群 */}
                    <div className="flex gap-2 flex-wrap pt-1">
                      {/* 投稿文生成 */}
                      {item.status !== "posted" && item.status !== "rejected" && (
                        <button
                          onClick={() => generateCaption(item.id)}
                          disabled={generatingId === item.id}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-amber-900/40 text-amber-300 border border-amber-800/40 hover:bg-amber-900/60 disabled:opacity-50 transition-all"
                        >
                          {generatingId === item.id
                            ? "⏳ 生成中..."
                            : hasCaption
                            ? "🔄 再生成"
                            : "✨ 投稿文生成"}
                        </button>
                      )}

                      {/* 承認→キュー（reviewed/draft のみ） */}
                      {canApprove && (
                        <button
                          onClick={() => approveItem(item.id)}
                          disabled={approvingId === item.id}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-green-900/40 text-green-300 border border-green-800/40 hover:bg-green-900/60 disabled:opacity-50 transition-all"
                        >
                          {approvingId === item.id ? "⏳ 処理中..." : "✅ 承認・キュー追加"}
                        </button>
                      )}

                      {/* 承認済みで再キューが必要な場合 */}
                      {item.status === "approved" && hasCaption && !!item.affiliate_url && (
                        <button
                          onClick={() => approveItem(item.id)}
                          disabled={approvingId === item.id}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-zinc-700 text-zinc-300 border border-white/10 hover:bg-zinc-600 disabled:opacity-50 transition-all"
                        >
                          {approvingId === item.id ? "⏳ 処理中..." : "🔁 再キュー追加"}
                        </button>
                      )}

                      {/* ステータス変更 */}
                      {item.status === "draft" && (
                        <button
                          onClick={() => updateStatus(item.id, "reviewed")}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-blue-900/40 text-blue-300 border border-blue-800/40 hover:bg-blue-900/60 transition-all"
                        >
                          📌 確認済みに
                        </button>
                      )}
                      {item.status !== "rejected" && item.status !== "posted" && (
                        <button
                          onClick={() => updateStatus(item.id, "rejected")}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-red-900/30 text-red-400 border border-red-900/40 hover:bg-red-900/50 transition-all"
                        >
                          🚫 拒否
                        </button>
                      )}

                      {/* 削除 */}
                      <button
                        onClick={() => deleteItem(item.id)}
                        className="ml-auto px-3 py-1.5 rounded-lg text-[11px] font-medium bg-zinc-700 text-zinc-400 border border-white/5 hover:bg-zinc-600 hover:text-red-400 transition-all"
                      >
                        🗑 削除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, isUrl }: { label: string; value: string; isUrl?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <span className="text-zinc-600 w-24 flex-shrink-0">{label}</span>
      {isUrl ? (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:underline truncate max-w-[200px]"
          onClick={(e) => e.stopPropagation()}
        >
          {value}
        </a>
      ) : (
        <span className="text-zinc-300 break-all">{value}</span>
      )}
    </div>
  );
}
