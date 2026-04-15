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

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Build**: esbuild (single bundle, ~2.5mb)
- **Storage**: GCS (Google Cloud Storage)
- **AI**: OpenAI GPT-4o, Anthropic Claude, Grok (X API)
- **Image Gen**: Nanobanana2 (Google Gemini 3.1 Flash) + GPT-4o Vision scoring
- **Dashboard**: React + Vite + TanStack Query + Recharts + Tailwind

## Key Commands

- `pnpm --filter @workspace/api-server run dev` — API server (bot scheduler)
- `pnpm --filter @workspace/bot-dashboard run dev` — Dashboard UI

## Architecture

```
artifacts/api-server/src/bot/
  scheduler.ts        — cron jobs: 10:30/17:00/20:00 JST 3スロット + Safety Engine統合
  safety-engine.ts    — 凍結回避: リスクスコアリング・自動化レベル管理・投稿バリデーション
  auto-meeting.ts     — 3-party AI meeting (Grok→GPT→Claude)
  strategy.ts         — strategy config (GCS: strategy-config.json)
  storage.ts          — post records, templates, meeting data (GCS)
  meeting.ts          — meeting room, directives, research sessions
  sheets-writer.ts    — Google Sheets auto-fill
  analytics.ts        — external pattern monitoring, metrics refresh
  fanza.ts            — FANZA API integration
  twitter.ts          — X (Twitter) API integration + pause/resume
  rebrandly.ts        — URL shortening + click tracking
  watchdog.ts         — bot health monitoring
  ai.ts               — AI text generation
  grok.ts             — Grok API for X insights
  imageGen.ts         — Nanobanana2 画像生成 API（text-to-image + image-to-image参照生成対応）
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

1. **Poll Lab** (@fanza_poll_lab): 手動投稿支援 — 次回投稿カウントダウン・投稿前チェックリスト・テンプレートコピー・曜日テーマ一覧
2. **先輩** (@ero_senpai1): API接続 — 安全レベル監視・KPI (インプ/クリック/いいね/RT)・操作 (TL同期/リンク同期/指標更新)・凍結回避ルール・ボット制御
3. **スタジオ**: FANZA検索→投稿文生成→画像生成 (Nanobanana2, 参照画像img2img対応) + 採点 (GPT-4o Vision, 橋本環奈100点基準)
4. **データ**: 投稿履歴・IP/EV推移グラフ・リスクスコア推移・クリック計測 (Rebrandly)・月額コスト

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
