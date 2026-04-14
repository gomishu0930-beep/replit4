# FANZA × MyFans 二刀流Bot — Workspace

## Overview

pnpm workspace monorepo using TypeScript. MyFans×FANZA二刀流アフィリエイト自動化システム。
@fanza_poll_lab アカウントで3ヶ月以内に月収¥54,000達成目標。
Production URL: `asset-manager-3-gomishu0930.replit.app`

## Strategy

- **収益目標**: 1ヶ月目¥18,000 → 2ヶ月目¥35,000 → 3ヶ月目¥54,000
- **内訳**: FANZA ¥30,000/月 + MyFans紹介 ¥3,000×8件=¥24,000/月
- **コンテンツ比率**: 70% エンゲージメント / 20% FANZA / 10% MyFans
- **投稿スロット**: 10:30 / 17:00 / 20:00 JST
- **月額コスト**: ¥25,799 (Replit¥3,000 + Twitter API¥15,000 + Rebrandly¥4,350 + Canva¥1,949 + OpenAI¥1,500)

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
  twitter.ts          — X (Twitter) API integration
  rebrandly.ts        — URL shortening + click tracking
  watchdog.ts         — bot health monitoring
  ai.ts               — AI text generation
  grok.ts             — Grok API for X insights
  imageScorer.ts      — 橋本環奈スコア自動採点 (GPT-4o Vision)
  contact.ts          — notification stubs
  celebrity.ts        — celebrity stubs (legacy)
  directive-executor.ts — directive execution stubs
  budget-review.ts    — budget briefing stubs

artifacts/api-server/src/routes/
  index.ts            — route aggregator
  bot.ts              — bot status, posts, rebrandly endpoints
  safety.ts           — safety engine API (6 endpoints)
  trigger.ts          — external trigger endpoints
  meeting.ts          — AI meeting room endpoints

artifacts/bot-dashboard/src/
  App.tsx             — 4タブ Dashboard (ホーム/投稿/分析/設定) ダークモード・モバイルファースト
```

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
- `POST /api/bot/image/score` — 画像URL採点（橋本環奈基準100点満点）
- `POST /api/bot/image/generate-and-score` — 画像生成＋自動採点
- `POST /api/bot/image/generate-until-pass` — 合格するまで再生成（最大N回）

## Dashboard (5タブ)

1. **ホーム**: 安全レベル・リスクスコア・KPI・投稿スケジュール
2. **投稿**: クイックアクション・投稿可否チェック・投稿履歴
3. **分析**: 収益目標・コンテンツ比率・リスク推移・クリック計測・エンゲージメント推移
4. **採点**: 画像URL採点 / プロンプト→生成＋採点（橋本環奈100点基準・10項目×10点）
5. **設定**: 凍結回避ルール・投稿上限段階制・自動化ロードマップ・月額コスト・ボット制御
