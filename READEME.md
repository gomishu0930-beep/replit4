# Project Overview

## Structure
This repository is a pnpm workspace project.

Main apps:
- `artifacts/api-server`
- `artifacts/mockup-sandbox`
- `artifacts/bot-dashboard`

## Runtime
- Node.js 24
- Python 3.11 (used for utility scripts / backup tasks)

## Backend
Directory:
- `artifacts/api-server`

Scripts:
- `build`: `node ./build.mjs`
- `start`: `node --enable-source-maps ./dist/index.mjs`
- `dev`: `pnpm run build && pnpm run start`

## Frontend 1
Directory:
- `artifacts/mockup-sandbox`

Scripts:
- `dev`: `vite dev`
- `build`: `vite build`
- `preview`: `vite preview`

## Frontend 2
Directory:
- `artifacts/bot-dashboard`

Scripts:
- `dev`: `vite --config vite.config.ts --host 0.0.0.0`
- `build`: `vite build --config vite.config.ts`
- `serve`: `vite preview --config vite.config.ts --host 0.0.0.0`

## Environment Variables
Required environment variables are listed in:
- `.env.example`

Do not commit real secrets to this repository.

## Storage
This project uses object storage.

## Notes
- Replit-specific secrets were removed from tracked config.
- App Storage backup was exported separately.
- GitHub is intended to become the source of truth for this project.
## Basic Setup
Install dependencies with pnpm.

Example:
- install: `pnpm install`

## Important
- Do not commit `.env`
- Do not commit backup files
- Use `.env.example` as the template