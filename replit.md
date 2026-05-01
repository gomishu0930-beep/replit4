# FANZA × MyFans 二刀流Bot — Workspace

## Overview

pnpm workspace monorepo using TypeScript. MyFans×FANZA二刀流アフィリエイト自動化システム。
**メイン**: @fanza_poll_lab（収益主軸・手動投稿 / Poll 2本/日）
**サブ**: @ero_senpai1（SBI計測専用・API接続済み / 青バッジ・フォロワー110）
Production URL: `asset-manager-3-gomishu0930.replit.app`

## Strategy (OODA v1.0 確定)

- **黒字化目標**: M5（フォロワー700人/月収¥26k超）
- **月額コスト**: ¥25,799 (Replit¥3,000 + Twitter API¥15,000 + Rebrandly¥4,350 + Canva¥1,949 + OpenAI¥1,500)
- **3ヶ月KPI**: M1フォロワー95/IP100/売上¥2.1k → M2フォロワー245/IP160/¥7.6k → M3フォロワー415/IP200/¥12.6k
- **二刀流ルール**: 相互RT禁止/同時刻投稿禁止/同一IP禁止/同アフィリID同日使用禁止

## Safety Engine (凍結回避)

- 最初30日: 手動のみ (MANUAL_ONLY)
- フォロワー300+: 半自動 (SEMI_AUTO)
- フォロワー1000+: 完全自動 (FULL_AUTO)
- アフィリリンク比率: 30%以下
- 連続アフィリ投稿: 1件まで
- 1日フォロー上限: 50件
- データ永続化: fanza-bot/data/safety-state.json (GCS)

## 安全運用システム (v2 実装済み)

- **`bot/run-config.ts`**: AUTO_POST_ENABLED / DRY_RUN / 日/時間上限 / cooldown管理 (初期値: DRY_RUN=true, AUTO_POST=false)
- **`bot/content-filter.ts`**: 危険ワードフィルター (未成年/非同意/強制等) + 画像プロンプト検査 / strict/moderate/permissive
- **`bot/post-queue.ts`**: 投稿キューシステム (pending→approved/rejected/posted/failed/dry_run)
- **`routes/queue.ts`**: `GET /api/bot/queue` / `POST /api/bot/queue/:id/approve|reject`。`manualDirect=true` でDiscord/ダッシュボードの「今すぐ投稿」と同じ手動投稿扱い。
- **`routes/health.ts`**: 拡張ヘルスチェック (rateLimit/安全制限/フィルター/キュー情報付き)
- **スケジューラー統合**: engagement/erotic-story/fanza/myfans全4スロット → フィルター検査→キュー追加→DRY_RUN制御
- **テスト**: vitest 16ケース全て合格 (safety.test.ts) / `pnpm --filter @workspace/api-server test`

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Build**: esbuild (single bundle, ~2.5mb)
- **Storage**: GCS (Google Cloud Storage)
- **AI**: OpenAI GPT-4o, Anthropic Claude, Grok (X API)
- **Image Gen**: fal.ai SDXL + Pony V6スタイル4-Block (プライマリ・fal-ai/lora) → fal.ai Realistic Vision V5.1 (セカンダリ・FANZA商用) → Nanobanana2 (参照画像対応) → DALL-E 3 (最終FB) + GPT-4o Vision scoring
- **Dashboard**: React + Vite + TanStack Query + Recharts + Tailwind

## Key Commands

- `pnpm --filter @workspace/api-server run dev` — API server (bot scheduler)
- `pnpm --filter @workspace/bot-dashboard run dev` — Dashboard UI
- `pnpm --filter @workspace/myfans-workflow run dev` — MyFans Workflow Server (port 3100)

## Architecture

```
artifacts/api-server/src/bot/
  scheduler.ts        — cron jobs: 10:30/17:00/20:00 JST 3スロット + Safety Engine統合
  safety-engine.ts    — 凍結回避: リスクスコアリング・自動化レベル管理・投稿バリデーション
  strategy.ts         — strategy config (GCS: strategy-config.json)
  storage.ts          — post records, templates, meeting data (GCS)
  meeting.ts          — meeting room, directives, research sessions
  sheets-writer.ts    — Google Sheets auto-fill
  analytics.ts        — external pattern monitoring, metrics refresh
  fanza.ts            — FANZA API integration
  twitter.ts          — X (Twitter) API integration + pause/resume
  rebrandly.ts        — URL shortening + click tracking
  watchdog.ts         — bot health monitoring
  ai.ts               — AI text generation（Grok調査→Claude生成パイプライン統合済み）
  grok.ts             — Grok API for X insights + researchBuzzForItem()リアルタイム市場調査
  imageGen.ts         — 画像生成（fal.ai SDXL/Pony V6スタイル4-Block + RV5.1 + Nanobanana2 + DALL-E 3 フォールバック）
  imageScorer.ts      — 橋本環奈スコア自動採点 (GPT-4o Vision)
  contact.ts          — notification stubs
  celebrity.ts        — celebrity stubs (legacy)
  directive-executor.ts — directive execution stubs
  budget-review.ts    — budget briefing stubs

artifacts/api-server/src/routes/
  index.ts            — route aggregator
  bot.ts              — bot status, posts, rebrandly, image gen/score endpoints
  safety.ts           — safety engine API (6 endpoints)
  trigger.ts          — external trigger endpoints + pause/resume
  meeting.ts          — AI meeting room endpoints

artifacts/bot-dashboard/src/
  App.tsx             — 4タブ Dashboard ダークモード・モバイルファースト
```

## Dashboard (4タブ)

1. **Poll Lab**: @fanza_poll_lab の手動Poll支援。次回投稿、曜日テーマ、本文コピー。
2. **運用**: キュー、収益候補補充、Rebrandly同期/作成、動画設定、DRY_RUN/自動投稿、今すぐ投稿。
3. **投稿**: FANZA検索、投稿文生成、選択作品のキュー追加、サンプル動画キュー、画像生成/採点。
4. **分析**: クリック、CTR、テンプレ勝ち負け、推奨投稿時間、リンク文A/B、週次AIレビュー。

## Revenue Posting Flow

- 収益候補は `revenue-queue.ts` に集約。ダッシュボード、Discord `/revenue-queue`、スケジューラーが同じ処理を使う。
- FANZA親投稿は「投稿文 + 画像/サンプル動画」、リプライに短縮アフィリエイトリンク。
- Rebrandly APIキーがある場合はキュー投入時に短縮リンクを自動作成。
- `AUTO_REVENUE_QUEUE_ENABLED=true` の場合、クリック実績から推奨された時間帯にFANZAキューを自動補充。
- Discord/ダッシュボードの「今すぐ投稿」は手動投稿扱い。DRY_RUN/日次上限はスキップし、コンテンツフィルターは維持する。

## MyFans Workflow Server (artifacts/myfans-workflow)

- **URL**: `/admin/myfans/` (管理UI) / `/api/myfans/affiliate/` (API)
- **ポート**: 3100 (環境変数 PORT)
- **ストレージ**: `.local/` 配下 JSON ファイル (ジョブ・ポストドラフト・動画アセット・クリップ)
- **プロキシパス**: `/api/myfans/affiliate`, `/api/claude`, `/api/videos`, `/admin/myfans`, `/admin/posts/*`, `/admin/videos`, `/media/*`

### myfans-workflow API エンドポイント
- `POST /api/myfans/affiliate/jobs` — アフィリエイトジョブ追加 (sourceUrl)
- `GET  /api/myfans/affiliate/jobs` — ジョブ一覧
- `GET  /api/myfans/affiliate/jobs/ready` — 処理済みジョブ一覧
- `GET  /api/myfans/affiliate/mobile/next` — 次の手動取得ジョブ
- `POST /api/myfans/affiliate/mobile/result` — 取得結果登録 (affiliateUrl)
- `POST /api/myfans/affiliate/mobile/skip` — ジョブスキップ
- `GET  /api/myfans/affiliate/stats` — 統計情報
- `POST /api/claude/generate-myfans-posts` — Claude投稿文生成
- `POST /api/myfans/posts/drafts` — 投稿ドラフト作成
- `GET  /api/myfans/posts/drafts` — ドラフト一覧
- `PATCH /api/myfans/posts/drafts/:id/status` — ステータス更新
- `POST /api/myfans/posts/drafts/:id/attach-clip` — クリップ添付
- `POST /api/myfans/posts/drafts/:id/mark-manually-posted` — 手動投稿済みマーク
- `POST /api/myfans/posts/generate-drafts` — ドラフト一括生成
- `GET  /api/videos/clips` — クリップ一覧
- `GET  /api/videos/assets` / `GET /api/videos/assets/:id` — 動画アセット

## MyFans 管理システム (旧実装・api-server内)

- **URL**: `/admin/myfans`
- **ストレージ**: `myfans-items.json` (GCS/ローカル二重保存)
- **AIキャプション生成**: Replit AI Integrations (Anthropic Claude haiku-4-5) — 自前APIキー不要
- **セキュリティ**: `MYFANS_INGEST_SECRET` で取り込みAPI保護

### 運用フロー
1. `取得ジョブ作成` → Computer Use へのJSON指示書を生成
2. Computer Use → `POST /api/myfans/ingest` でJSON+メディア取り込み
3. Dashboard で `✨投稿文生成` (4文体: 友達口調/販促/夜向け/レビュー)
4. 安全フィルター自動チェック → `✅承認・キュー追加` → 既存投稿キューへ
5. ステータス: draft → reviewed → approved → posted

### API Endpoints (MyFans)
- `POST /api/myfans/fetch-job` — 取得ジョブ作成 (Authorization: Bearer)
- `POST /api/myfans/ingest` — JSON+メディア取り込み (multipart/form-data)
- `GET  /api/myfans/items` — 一覧 (?status=draft|reviewed|approved|rejected|posted)
- `POST /api/myfans/items/:id/generate-caption` — AI投稿文生成 ({style: friend|promo|night|review})
- `PATCH /api/myfans/items/:id/status` — ステータス更新
- `POST /api/myfans/approve` — 承認→投稿キュー追加
- `DELETE /api/myfans/items/:id` — 削除
- `GET  /api/myfans/media/:filename` — アップロード済みメディア配信

## API Endpoints

### Safety Engine
- `GET /api/safety/status` — 安全状態全体
- `GET /api/safety/automation` — 自動化レベル詳細
- `POST /api/safety/validate` — 投稿可否チェック
- `POST /api/safety/record-post` — 投稿記録
- `POST /api/safety/record-follow` — フォロー記録
- `POST /api/safety/update-followers` — フォロワー数更新

### Bot
- `GET /api/bot/status` — ボット稼働状態
- `GET /api/bot/posts` — 投稿履歴
- `GET /api/bot/rebrandly` — Rebrandlyクリックデータ
- `POST /api/bot/rebrandly/sync` — Rebrandly手動同期
- `POST /api/bot/rebrandly/auto-create` — キュー内アフィリエイトURLの短縮リンク作成
- `GET /api/bot/fanza-search` — FANZA検索（rank/sale/revenue/keyword等）
- `POST /api/bot/fanza-revenue-queue` — 収益候補を自動選定してキュー投入
- `POST /api/bot/fanza-item-queue` — ダッシュボードで選んだ作品をキュー投入
- `GET /api/bot/sample-video/status` — サンプル動画処理状態
- `POST /api/bot/sample-video/queue` — 許可メーカーのサンプル動画を短尺化してキュー投入
- `POST /api/bot/posts/sync-timeline` — TL同期
- `POST /api/bot/nanobanana/generate` — 画像生成 (Nanobanana2)
- `POST /api/bot/nanobanana/upload` — 画像アップロード (Twitter media)
- `POST /api/bot/image/score` — 画像URL採点（橋本環奈基準100点満点）
- `POST /api/bot/image/generate-and-score` — 画像生成＋自動採点
- `POST /api/bot/image/generate-until-pass` — 合格するまで再生成（最大N回）

### Trigger (same-origin or secret auth)
- `POST /api/trigger/pause` — ボット緊急停止
- `POST /api/trigger/resume` — ボット再開
- `GET /api/trigger/pause-status` — 停止状態確認
- `POST /api/trigger/metrics` — 指標更新
- `POST /api/trigger/rank` — 高評価投稿
- `POST /api/trigger/sale` — セール投稿
- `POST /api/trigger/meeting-post` — AI会議→投稿
