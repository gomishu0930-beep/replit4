# FANZA X Bot — Workspace

## Overview

pnpm workspace monorepo using TypeScript. FANZA affiliate adult content X (Twitter) bot for @gomi_shu_god.
Production URL: `asset-manager-3-gomishu0930.replit.app`

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Build**: esbuild (single bundle, ~2.6mb)
- **Storage**: GCS (Google Cloud Storage) — posts, templates, strategy, meeting data
- **AI**: OpenAI GPT-4o / GPT-4o-mini, Anthropic Claude, Grok (X API)

## Key Commands

- `pnpm --filter @workspace/api-server run dev` — API server (bot scheduler)
- `pnpm --filter @workspace/bot-dashboard run dev` — Dashboard UI

## Architecture

```
artifacts/api-server/src/bot/
  scheduler.ts        — cron jobs, posting slots, catch-up logic
  auto-meeting.ts     — 3-party AI meeting (Grok→GPT→Claude)
  celebrity.ts        — celebrity mapping + Vision scoring
  directive-executor.ts — decision auto-execution engine
  codex-agent.ts      — [NEW] autonomous config changes via GPT-4o
  sheets-writer.ts    — [NEW] Google Sheets auto-fill
  strategy.ts         — strategy config (GCS: strategy-config.json)
  storage.ts          — post records, templates, meeting data (GCS)
  meeting.ts          — meeting room, directives, research sessions
```

## Posting Schedule (W1 Period: 4/7–4/13)

- **20:00 JST**: Celebrity affiliate post (3-party AI meeting → X post)
- Catch-up window: 6h after slot time, 30-min periodic check
- Double-post protection: `getCelebPostedDate()` stored in GCS

## Codex Agent (autonomous code changes)

`codex-agent.ts` uses GPT-4o to modify GCS config files when the AI meeting makes decisions:
- `scheduler-overrides.json` — posting times, W1/W2 date ranges, catch-up window
- `celebrity-config.json` — celebrity mappings (add/modify)
- `meeting-prompts.json` — meeting style notes

Triggered via `directive-executor.ts` action type `code.codex`.

## Google Sheets Auto-fill (PENDING SETUP)

> **Note**: Google Sheets integration requires user setup. The code is in `sheets-writer.ts`.
> The Replit OAuth connector was not authorized. To enable:
>
> 1. Go to [Google Cloud Console](https://console.cloud.google.com/iam-admin/serviceaccounts)
> 2. Create a service account → Create key (JSON) → Download
> 3. Share your target Google Spreadsheet with the service account email (Editor access)
> 4. Add to Replit Secrets:
>    - `GOOGLE_SERVICE_ACCOUNT_JSON`: contents of the downloaded JSON file
>    - `GOOGLE_SHEET_ID`: the ID from your spreadsheet URL (`/d/XXXXX/`)
>
> Sheets populated: `PostLog` (投稿ログ) + `DecisionLog` (決定事項)

## GCS Bucket

`replit-objstore-d1d25208-c118-4823-ab4e-4ec919bf4b01`

## Secrets Required

| Secret | Purpose |
|---|---|
| `OPENAI_API_KEY` | GPT-4o, GPT-4o-mini, Vision scoring |
| `SESSION_SECRET` | Express session |
| `TWITTER_API_KEY/SECRET` | Twitter API v2 |
| `TWITTER_ACCESS_TOKEN/SECRET` | Bot account auth |
| `TWITTER_USER_ID` | `1114297552268959744` |
| `DMM_AFFILIATE_ID/API_ID` | FANZA API |
| `REBRANDLY_API_KEY` | Link shortening + click tracking |
| `SMTP_USER/PASS` | Email notifications |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | GCS bucket |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | *(optional)* Google Sheets |
| `GOOGLE_SHEET_ID` | *(optional)* Google Sheets |

## User Preferences

- Dashboard: White/Apple-style UI, 4 tabs (ホーム/投稿/分析/管理)
- Bot mode: W1 A/B test (20:00 JST only, 1 post/day)
- No image generation on URL posts (`enableOnUrlPost=false`)
- Celebrity posts via 3-party meeting (Grok→GPT→Claude)
- Avoid restarting API server during 19:00–21:30 JST (W1 freeze window)
