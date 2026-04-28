# AI Setup Instructions

## Project type
This repository is a pnpm workspace project.

## Runtime
- Node.js 24
- pnpm

## Main apps
- artifacts/api-server
- artifacts/mockup-sandbox
- artifacts/bot-dashboard

## Install
Run from repository root:

```bash
pnpm install
Common commands
API server
pnpm run dev:api
pnpm run build:api
pnpm run start:api
Mockup sandbox
pnpm run dev:mockup
pnpm run build:mockup
pnpm run preview:mockup
Bot dashboard
pnpm run dev:dashboard
pnpm run build:dashboard
pnpm run serve:dashboard
Rules
Do not commit real secrets
Use .env.example as the template
Do not commit backup files
Keep changes minimal and scoped
Prefer editing existing structure instead of rewriting unrelated files
Important notes
Backend main app: artifacts/api-server
Object storage is used in this project
Replit-specific settings were partially removed during migration