# VindraPay Documentation

Architecture, API reference, and operator guides for the VindraPay monorepo.

- Backend API: [`backend/README.md`](../backend/README.md) — endpoint tables, provider templates, scripting, balance calibration, env vars, sqlc workflow
- Admin console: [`studio/README.md`](../studio/README.md) — architecture, CLI flags, auth/session model, troubleshooting
- Android monitor: [`android-app/README.md`](../android-app/README.md) — capture pipeline, upload, build/signing, OEM survival guide
- TypeScript SDK: [`sdk/README.md`](../sdk/README.md) — clients, pagination, error handling, live E2E

## 1. System architecture

```
┌──────────┐  SMS   ┌─────────────────┐  HTTPS (1–50/batch)  ┌──────────────────┐
│ Customer │ ──────> │ Android monitor │ ────────────────────> │ Backend (Go+Gin) │
│  MFS app │  TrxID  │  spare phone    │  heartbeat (providers)│  Postgres (pgx)  │
└──────────┘ ──────> └─────────────────┘ <──────────────────── └────────┬─────────┘
  pays merchant        captures + dedups                                   │
  shares TrxID         foreground svc + WorkManager                        │ verify
                                                                          ▼
┌──────────────┐  Bearer mgmt key   ┌────────────────┐   Bearer vpk_  ┌─────────────┐
│ Studio (Svelte│ <────────────────> │ /manage/v1 (all)│   /api/v1     │ Merchant    │
│ + Fastify)   │  never to browser  │ /device/v1      │ <────────────> │ server / SDK│
└──────────────┘                    └────────────────┘   TrxID claim   └─────────────┘
```

**Request flow (backend):** `Gin → Auth (tenant / device / global) → RateLimit (verify only) → Handler → Service (Verify / Ingest) + sqlc queries → Postgres`. Verify and ingest share the same `smsparser` + `scripting` pipeline. All responses are enveloped `{ success, data }` / `{ success: false, error, result? }`.

**Key design decisions:**

- Exact money: `NUMERIC(12,2)` + `shopspring/decimal` end to end; floats never touch amounts.
- Idempotency: orders dedup on `(business_id, external_order_id)`; SMS dedup on `(device_id, client_msg_id)` server-side and `SHA-256(sender|body|epochSecond)` client-side; transactions dedup on `(provider_id, trx_id)`.
- Single-claim enforcement: partial unique index `orders(matched_transaction_id) WHERE NOT NULL` — a TrxID pays at most one order.
- Per device+provider balance trails, so one phone with multiple SIMs keeps independent chains.

## 2. Authentication

Three trust domains, all `Authorization: Bearer <token>` (case-insensitive scheme):

| Credential | Format | Stored as | Unlocks | Scope |
| ---------- | ------ | --------- | ------- | ----- |
| Merchant API key | `vpk_` + 48 hex | `SHA-256` hash + 8-char prefix lookup | `/api/v1/*` | Exactly one business |
| Device token | `vdt_` + 48 hex | `SHA-256` hash + prefix lookup | `/device/v1/*` | Exactly one phone |
| Management key | Any string (`MANAGEMENT_API_KEY`) | Env only, never in DB | `/manage/v1/*` | Global |

Merchant keys and device tokens are issued via the Management API with plaintext shown **exactly once**; revocation is `revoked_at` / `deactivated_at` (idempotent). When `MANAGEMENT_API_KEY` is empty, `/manage/v1/*` routes are not registered at all (requests 404 to hide existence).

## 3. API reference

### 3.1 Public

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/healthz` | `{ app, env, db: up\|down, time }`; 503 when DB is down |
| GET | `/api/v1/ping` | Liveness probe |

### 3.2 Merchant — `/api/v1` (`vpk_…`, tenant-scoped)

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST | `/orders` | Create order; idempotent on `external_order_id`. Body: `external_order_id`, `expected_amount` (string, exact, > 0, ≤ 2dp), optional `expires_at` (RFC3339), `metadata` (JSON) |
| GET | `/orders/:external_order_id` | Fetch own order |
| POST | `/orders/:external_order_id/verify` | Claim a TrxID. Body: `trx_id`. Rate-limited per business. Returns `result: success` + order + transaction + `balance_consistent`, or a typed failure |
| POST | `/providers` | Create template (`name`, `sender_id?`, `sms_template`, `priority?`, `direction?`, `match_mode?`, `script?`) |
| GET | `/providers` | List own + global builtins |
| GET | `/providers/:id` | Get one (own or global) |
| PUT | `/providers/:id/template` | Update own template / direction / match mode / script |
| DELETE | `/providers/:id` | Deactivate own template |
| POST | `/providers/test` | Dry-run `{ sms_template, sample_body, match_mode?, script? }` → `{ match, fields, transformed?, rejected?, reject_reason? }` |
| POST | `/devices/:device_id/calibrate-balance` | Record authoritative balance anchor `{ provider_id, balance, note? }` |
| GET | `/devices/:device_id/balance?provider_id=` | Latest balance point `{ balance, source, point_at }` |

`verify` failure mapping: `not_found` → 404, `already_used` / `order_expired` / `order_not_pending` → 409, `amount_mismatch` / `balance_mismatch` / `wrong_direction` → 422. Every attempt is written to `verification_attempts` with `source_ip`.

### 3.3 Device — `/device/v1` (`vdt_…`, one phone)

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST | `/heartbeat` | Liveness + provider sync. Optional `{ app_version, os_version }`. Returns matchable `providers[]` (no secrets). Empty body tolerated |
| POST | `/messages` | Ingest 1–50 SMS: `{ client_msg_id (uuid), sender_id?, body, device_received_at? }` → per-message `{ status: parsed\|duplicate\|unmatched\|error\|skipped, error? }` |

### 3.4 Management — `/manage/v1` (global; disabled without `MANAGEMENT_API_KEY`)

List endpoints accept `?limit` (default 20, max 100) + `?offset` and return `{ items, total }`.

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/features` | `{ allow_unsafe_scripts, script_timeout_ms }` |
| GET/POST | `/businesses` | List (status/search filters) / create `{ name, owner_email }` |
| GET / PATCH | `/businesses/:business_id` (+ `/status`) | Fetch / suspend (`active\|suspended`) |
| GET / POST | `/businesses/:business_id/api-keys` | List (hashes never exposed) / issue `vpk_…` (plaintext once) |
| DELETE | `/api-keys/:key_id` | Revoke (idempotent) |
| GET | `/devices` | All devices + derived `online` (`last_ping` within 5 min) |
| POST / DELETE | `/businesses/:business_id/devices` / `/devices/:device_id` | Register (`vdt_…` once) / deactivate |
| GET | `/orders`, `/transactions`, `/attempts`, `/messages` | Global views with business/status/result/parse-status filters; messages inbox is the SMS debugging view |
| GET | `/stats` | `{ businesses_total, devices_online, transactions_total/today, orders_pending/paid, attempts_today, messages_unparsed }` |
| GET/POST/PUT/DELETE | `/providers…` | Same template CRUD as merchant but global (`business_id: null` = builtin); identical `/test` |
| POST / GET | `/devices/:device_id/calibrate-balance` / `/devices/:device_id/balance` | Cross-business variants of the merchant balance endpoints |

## 4. Verification algorithm

`POST /orders/:id/verify { trx_id }` evaluates in this order (each step writes a `verification_attempts` row):

1. Order exists (own business) → else `not_found`.
2. Order is `pending` and unexpired → else `order_expired` / `order_not_pending`. (A background sweeper flips stale `pending` orders to `expired` every 60 s.)
3. Transaction with this TrxID exists **in this business** → else `not_found`. Shared personal numbers resolve to whichever business ingested first.
4. Direction is `credit` → debits are trail-only, else `wrong_direction`.
5. `effective_amount` (script-adjusted, else raw `amount`) exactly equals `expected_amount` → else `amount_mismatch`.
6. Balance continuity (only when the SMS stated a balance): expected = previous point ± amount on the same device+provider; equal → consistent, contradicted → `balance_mismatch`, no history → `null` (check skipped). A stuck transaction is rescued when its stated balance equals the latest later calibration.
7. Atomic claim (`WHERE pending AND matched IS NULL`): success → `200 success` + order marked `paid`; lost race / double-spend → `already_used`.

## 5. Providers, parsing, and custom logic

- **Template mode** (default): literals + `{amount|sender|trxId|balance|balance?}` placeholders compile to case-insensitive RE2. Requires `amount` + `trxId`. Amounts accept commas and Bengali digits `০-৯`.
- **Regex mode** (`match_mode: "regex"`): raw RE2 with named groups `(?P<amount>…)`, `(?P<trxId>…)` required; `sender`/`balance` optional. Linear-time guaranteed (no lookahead/backreferences).
- **Direction**: `credit` = money received (claimable); `debit` = money leaving (recorded so cash-outs don't break the balance chain). One provider per SMS format.
- **Shadowing warning**: if two active templates match the same SMS, the earliest-created wins silently — deactivate superseded templates.
- **Scripts** (optional JS per provider, goja sandbox, 100 ms default budget, no network/dates/random/regex): inputs `amount/sender/trxId/balance/body/direction/providerName`; helpers `round/abs/min/max/floor/ceil/lower/upper/trim/fixed/reject`. Returning `amount` sets `effective_amount` (order matching); the raw amount still feeds the balance chain. `reject(reason)` marks the message `skipped`. `trxId`/`balance` overrides require `ALLOW_UNSAFE_SCRIPTS=true`.
- Seeded global builtins: bKash, Nagad, Rocket, Upay (best-effort defaults, editable per deployment).

Validate everything with `POST /providers/test` before saving; debugging lives in `GET /manage/v1/messages` (parse status, error codes, matched pattern) and `GET /manage/v1/attempts`.

## 6. Balances and calibration

When the recorded trail drifts (outage, dead battery, parse failures), honest payments fail `balance_mismatch`:

1. `GET …/devices/:id/balance?provider_id=` — latest point + source (`transaction` vs `calibration`).
2. Read the real balance in the MFS app.
3. `POST …/devices/:id/calibrate-balance { provider_id, balance, note? }` — inserts an authoritative anchor; future checks chain from it.

Trails are scoped per **device + provider**. After confirmed fraud, recalibrate the affected pair so the poisoned point doesn't cascade.

## 7. Data model

`businesses` → `api_keys`, `devices` → `providers` (nullable `business_id` = global builtin), `raw_messages` (inbox, `parse_status: pending|parsed|unmatched|error|skipped`), `transactions` (`UNIQUE(provider_id, trx_id)`), `orders` (`UNIQUE(business_id, external_order_id)`, single-claim partial unique on `matched_transaction_id`), `verification_attempts` (audit log incl. `source_ip`), `balance_calibrations` (anchors). Migrations: `backend/db/migrations/000001..000007` (`.up.sql`/`.down.sql`); typed access via sqlc (`backend/db/queries/*.sql` → `backend/internal/db/`, committed — run `make sqlc` after changing SQL).

## 8. Operations

- **Environments**: `backend/.env` (`PORT`, `DATABASE_URL`, `RATE_LIMIT_MAX_ATTEMPTS/WINDOW_SECONDS`, `SCRIPT_TIMEOUT_MS` clamped 10–1000, `ALLOW_UNSAFE_SCRIPTS`, `MANAGEMENT_API_KEY`) and `studio/.env` (`STUDIO_PORT/HOST/BACKEND_URL/API_KEY/AUTH_PASSWORD/TIMEOUT_MS`); flag > env > default for Studio.
- **Builds**: `cd backend && make build-all` (static CGO-free Linux/Windows) or `./scripts/build.ps1`; `cd studio && pnpm build && pnpm start`; `cd android-app && ./gradlew :app:assembleRelease`.
- **Tests**: `backend: go test ./...` (tokens, SMS compiler, scripting sandbox) · `studio: pnpm test` (config, session auth, proxy mapping) · `sdk: pnpm test` (+ live `pnpm test:e2e` against a real backend) · `android-app: ./gradlew :app:testDebugUnitTest` (dedup, batching).
- **Known limitations**: leftmost-match-wins (one transaction per SMS); cross-business shared numbers resolve to first ingester; sender gates are best-effort (SMS spoofable); rejected transactions keep their balance point until recalibration.
