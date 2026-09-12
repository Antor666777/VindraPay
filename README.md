# VindraPay

Self-hosted mobile-money payment verification for Bangladesh MFS (bKash, Nagad, Rocket, Upay).

VindraPay turns a spare Android phone into a payment gateway: the phone captures incoming payment SMS, the Go backend parses and verifies them against merchant orders, and merchants confirm payments by TrxID — no telco API, no aggregator fees.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](sdk/LICENSE)
[![Go](https://img.shields.io/badge/backend-Go%201.27-00ADD8.svg)](backend/)
[![Studio](https://img.shields.io/badge/studio-Fastify%20%2B%20Svelte%205-ff3e00.svg)](studio/)
[![Android](https://img.shields.io/badge/android-Kotlin%20%2B%20Compose-3DDC84.svg)](android-app/)
[![SDK](https://img.shields.io/badge/sdk-TypeScript-blue.svg)](sdk/)

## How it works

```
Customer pays via MFS ──SMS──> Android monitor ──HTTPS──> Backend ──verify──> Merchant app
     (bKash/Nagad)        (spare phone)      (parse + store)      (order paid?)
```

1. **Merchant creates an order** — `POST /api/v1/orders` with `external_order_id` + `expected_amount`.
2. **Customer pays** with mobile money and sends back the **TrxID** from their SMS.
3. **Android monitor** (spare phone with the merchant SIM) captures the payment SMS and uploads it in batches to `POST /device/v1/messages`.
4. **Backend parses** the SMS via a provider template (template or RE2 regex + optional sandboxed JS), stores an exact-decimal transaction.
5. **Merchant verifies** — `POST /api/v1/orders/:id/verify { trx_id }`. The backend checks existence, exact amount, credit direction, single-claim, expiry, and arithmetic balance continuity, then marks the order `paid`.
6. **Operators** manage everything (businesses, keys, devices, inbox, attempts, calibration) from **Studio** or the **TypeScript SDK**.

## Features

- **TrxID verification** with explicit failure reasons: `not_found`, `already_used`, `amount_mismatch`, `order_expired`, `order_not_pending`, `balance_mismatch`, `wrong_direction`
- **SMS parsing engine** — `{amount,sender,trxId,balance}` templates, RE2 regex mode, Bengali-digit + comma normalization, built-in bKash / Nagad / Rocket / Upay seeds
- **Sandboxed custom logic** per provider (goja JS, 100 ms budget, fee/dust/MSDSN normalization, `reject()` support)
- **Balance-chain anti-fraud** — per device+provider arithmetic continuity checks plus manual calibration anchors
- **Three isolated auth domains** — merchant keys (`vpk_…`), device tokens (`vdt_…`), management key (env-only, disables `/manage/v1` when unset)
- **Admin console (Studio)** — single-origin Fastify proxy + Svelte 5 SPA; your management key never reaches the browser
- **Android monitor** — Compose UI, multipart reassembly, SHA-256 dedup, foreground service + WorkManager uploads, encrypted token storage
- **Official TypeScript SDK** (`vindrapay-sdk`) — typed clients for all three surfaces, retries, pagination helpers, MSW + live E2E tests
- **Exact money handling** — `NUMERIC(12,2)` + `shopspring/decimal` throughout; no floats

## Monorepo

| Component | Directory | Stack | Docs |
| --------- | --------- | ----- | ---- |
| API backend | [`backend/`](backend/README.md) | Go 1.27 + Gin + Postgres (pgx + sqlc) | [backend/README](backend/README.md) |
| Admin studio | [`studio/`](studio/README.md) | Fastify 5 + Svelte 5 + Vite 7, Node ≥ 22 | [studio/README](studio/README.md) |
| Android monitor | [`android-app/`](android-app/README.md) | Kotlin 2.0.20 + Compose, minSdk 24 | [android-app/README](android-app/README.md) |
| TypeScript SDK | [`sdk/`](sdk/README.md) | TypeScript, Node ≥ 18, zero deps | [sdk/README](sdk/README.md) |
| Architecture & API docs | [`docs/`](docs/README.md) | — | [docs/README](docs/README.md) |

## Quickstart

### Prerequisites

- Go 1.27+, Postgres 14+ (with `pgcrypto`), Node ≥ 22 + pnpm, Android Studio Ladybug+ (for the app)

### 1. Start the backend

```powershell
Copy-Item backend/.env.example backend/.env
# Edit backend/.env: set DATABASE_URL and choose a MANAGEMENT_API_KEY
```

```bash
# Apply migrations in order (000001..000007), e.g. with psql:
psql "$DATABASE_URL" -f backend/db/migrations/000001_init.up.sql
# ... repeat for 000002..000007, or loop over *.up.sql

cd backend
go run ./cmd/api   # listens on :8080, /healthz should report {"db":"up"}
```

### 2. Start Studio (admin UI)

```bash
# backend/.env must have MANAGEMENT_API_KEY=<long-random-string>
cd studio
cp .env.example .env   # set STUDIO_API_KEY to the same value
pnpm install
pnpm dev               # API on :5175, UI with HMR on :5176
```

Open the UI, create a business, then issue a merchant key (`vpk_…`, shown once) and register a device (`vdt_…`, shown once).

Production-style: `pnpm build && pnpm start -- --api-key <key> --host 0.0.0.0 --port 8081`.

### 3. Pair the Android monitor

1. Build in Android Studio: `./gradlew :app:assembleDebug` (or install the signed APK from [Releases](https://github.com/Antor666777/VindraPay/releases)).
2. Complete onboarding on the spare phone: grant SMS permissions → disable battery optimization → enter base URL + `vdt_…` token → connection test.
3. Confirm the top-bar pill turns green and provider chips appear after the first heartbeat.

### 4. Verify your first payment (SDK)

```bash
pnpm add vindrapay-sdk
```

```ts
import { VindraPay } from "vindrapay-sdk";

const vp = new VindraPay({ baseUrl: "http://localhost:8080" });
const merchant = vp.merchant(process.env.MERCHANT_API_KEY!);

await merchant.orders.create({ externalOrderId: "order-1001", expectedAmount: "500.00" });

// After the customer pays and shares their TrxID:
const res = await merchant.orders.verify("order-1001", { trxId: "9B7ACXYZ99" });
console.log(res.result); // "success" → order is now paid
```

See [`sdk/README.md`](sdk/README.md) for management/device usage, error handling (`ConflictError`, `RateLimitError`, …), and `listAll()` pagination.

## API surfaces

All requests use `Authorization: Bearer <token>`. Responses are enveloped as `{ success, data }` or `{ success: false, error, result? }`.

| Surface | Auth | Base path | Purpose |
| ------- | ---- | --------- | ------- |
| Public | none | `/healthz`, `/api/v1/ping` | Health + liveness |
| Merchant | `vpk_…` (one business) | `/api/v1/*` | Orders, verify (rate-limited), providers, balance read/calibrate |
| Device | `vdt_…` (one phone) | `/device/v1/*` | `heartbeat` (provider sync), `messages` (1–50 SMS batch) |
| Management | `MANAGEMENT_API_KEY` (global) | `/manage/v1/*` | Businesses, keys, devices, orders, transactions, attempts, inbox, stats, providers |

Full endpoint tables, request/response shapes, and verification order-of-checks: [`docs/README.md`](docs/README.md) and [`backend/README.md`](backend/README.md).

## Configuration

| File | Purpose |
| ---- | ------- |
| `backend/.env` (from [`.env.example`](backend/.env.example)) | `PORT`, `DATABASE_URL`, `RATE_LIMIT_*`, `SCRIPT_TIMEOUT_MS`, `ALLOW_UNSAFE_SCRIPTS`, `MANAGEMENT_API_KEY` |
| `studio/.env` (from [`.env.example`](studio/.env.example)) | `STUDIO_PORT/HOST/BACKEND_URL/API_KEY/AUTH_PASSWORD/TIMEOUT_MS` |

Key behaviors worth knowing upfront:

- Empty `MANAGEMENT_API_KEY` **disables all `/manage/v1` routes** (Studio and SDK management clients will 404).
- Only `credit` transactions are claimable; `debit` providers exist to keep the balance trail complete.
- Balance verification is arithmetic continuity (`prev ± amount == stated`), not equality — see [Balance calibration](backend/README.md#balance-calibration).
- `POST /providers/test` dry-runs any template/regex/script against a sample SMS before saving.

## Development

```bash
# Backend
cd backend && go test ./... && make build-all

# Studio
cd studio && pnpm typecheck && pnpm test

# SDK (mock tests + optional live E2E against a real backend)
cd sdk && pnpm typecheck && pnpm test
SDK_E2E_URL=http://localhost:8080 SDK_E2E_MANAGEMENT_KEY=<key> pnpm test:e2e

# Android
cd android-app && ./gradlew :app:testDebugUnitTest
```

Database code is generated with sqlc (`db/queries/*.sql` → `internal/db/`, committed): `make sqlc` after changing SQL.

## Security notes

- Merchant keys / device tokens are stored as SHA-256 hashes; plaintext is returned exactly once at issuance.
- Sender-ID gates are best-effort — SMS sender IDs are spoofable. Treat `balance_mismatch` rejections and the raw inbox as fraud signals, and recalibrate after confirmed fraud.
- Studio sessions are `HttpOnly; SameSite=Strict` but not `Secure` by design (self-hosted HTTP). Serve behind a TLS-terminating reverse proxy for LAN exposure.
- The Android app sets `usesCleartextTraffic="true"` for LAN setup; put TLS in front of the backend for production.

## License

MIT — see [`sdk/LICENSE`](sdk/LICENSE).

## Links

- Issues: <https://github.com/Antor666777/VindraPay/issues>
- Backend: [`backend/README.md`](backend/README.md) · Studio: [`studio/README.md`](studio/README.md) · App: [`android-app/README.md`](android-app/README.md) · SDK: [`sdk/README.md`](sdk/README.md) · Docs: [`docs/README.md`](docs/README.md)
