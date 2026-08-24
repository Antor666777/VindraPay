# VindraPay Studio

Self-hosted admin console for the VindraPay backend. Fastify + TypeScript server that proxies the backend's universal Management API (`/manage/v1`) and serves a Svelte 5 single-page app — your API key never touches the browser.

## Architecture

```
Browser ──HTTP──> Studio (Fastify :5175) ──Bearer MANAGEMENT_API_KEY──> VindraPay backend (:8080)
   │                    │
   └── Svelte SPA       └── /studio-api/* proxy · session gate · static files
```

## Prerequisites

- Node.js >= 22 and [pnpm](https://pnpm.io)
- A running VindraPay backend (`backend/`), with `MANAGEMENT_API_KEY` set in its `.env`

## Quickstart

```bash
# 1. In backend/.env choose a management key
MANAGEMENT_API_KEY=<some-long-random-string>

# 2. Start the backend
cd backend && go run ./cmd/api

# 3. Configure the studio once (gitignored)
cd ../studio
cp .env.example .env        # then set STUDIO_API_KEY=<the-same-management-key>

# 4. Run
pnpm install
pnpm dev                    # server + hot-reloading UI, reads studio/.env
```

Production-style run:

```bash
pnpm build
pnpm start -- --api-key <key> --host 0.0.0.0 --port 8081
```

> **Flag gotcha:** under `pnpm dev`, extra flags are swallowed by `concurrently` and never reach the server — configure via `studio/.env` (recommended) or target a single process: `pnpm dev:server -- --api-key <key>`.

## CLI Flags

| Flag | Env | Default | Notes |
| ---- | --- | ------- | ----- |
| `--port <n>` | `STUDIO_PORT` | `5175` | 1–65535 |
| `--host <addr>` | `STUDIO_HOST` | `127.0.0.1` | bind `0.0.0.0` for LAN access |
| `--backend-url <url>` | `STUDIO_BACKEND_URL` | `http://localhost:8080` | trailing slash stripped |
| `--api-key <key>` | `STUDIO_API_KEY` | **required** | same value as backend's `MANAGEMENT_API_KEY`; never sent to the browser |
| `--auth-password <pw>` | `STUDIO_AUTH_PASSWORD` | unset = no UI gate | when set, browser asks once; HttpOnly SameSite=Strict cookie; 5 wrong attempts / 5 min per IP → 429 |
| `--timeout-ms <n>` | `STUDIO_TIMEOUT_MS` | `10000` | clamped 1000..120000 |
| `--open` | — | off | best-effort browser auto-open |
| `-h`, `--help` | — | — | usage |

Precedence: **flag > environment > default**. Unknown flags are rejected with a hint to run `--help`. A missing API key is fatal by design.

> LAN caveat: sessions cookies are `SameSite=Strict; HttpOnly` but not `Secure` (self-hosted HTTP). Prefer localhost or a TLS-terminating reverse proxy for remote exposure.

## Scripts

| Script | Purpose |
| ------ | ------- |
| `pnpm dev` | server (tsx watch) + Vite dev server concurrently — config comes from `studio/.env` |
| `pnpm dev:server -- <flags>` | server only, flags pass through (`--api-key`, `--port`, …) |
| `pnpm build` | build SPA (`dist/web`) + compile server (`dist/server`) |
| `pnpm start -- <flags>` | run compiled server with CLI flags |
| `pnpm test` | vitest (config parsing, session auth, proxy error mapping) |
| `pnpm typecheck` | strict TS across server + web |

## Project Layout

```
studio/
├── src/server/        # Fastify: config/CLI, auth, proxy, static, tests
├── src/web/           # Svelte 5 SPA (runes)
├── dist/              # build output (gitignored)
└── vite.config.ts     # dev port 5176, proxies /studio-api -> :5175
```

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| "Missing required API key" when running `pnpm dev --api-key …` | flags after `pnpm dev` go to `concurrently`, not the server — put `STUDIO_API_KEY=…` in `studio/.env`, or run `pnpm dev:server -- --api-key …` / `pnpm start -- --api-key …` |
| `EADDRINUSE` on boot | another process owns the port — pass `--port <n>` (or set `STUDIO_PORT`) |
| UI loads but every call says "backend unreachable" | backend down or wrong `--backend-url` |
| Persistent 401 from `/studio-api/*` | `--api-key` differs from backend `MANAGEMENT_API_KEY`, or backend started without it (management routes disabled) |
| Login rejects correct password | password changed after boot — restart the studio |
