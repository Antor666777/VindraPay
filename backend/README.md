# vindrapay-go

VindraPay backend API service (part of the VindraPay monorepo), built with [Gin](https://github.com/gin-gonic/gin).

## Project Structure

```
backend/
├── cmd/
│   └── api/           # Application entry point
├── internal/          # Private application code
│   ├── config/        # Configuration (.env loading)
│   ├── db/            # sqlc-generated code (do not edit manually)
│   ├── database/      # Postgres connection pool (pgx)
│   ├── handler/       # HTTP handlers
│   ├── handlers/      # HTTP handlers (merchant + management surfaces)
│   ├── middleware/    # Gin middleware (auth, rate limit)
│   ├── model/         # Domain models / entities
│   ├── router/        # Route registration
│   ├── scripting/     # Sandboxed JavaScript engine for provider logic
│   ├── services/      # Business logic (ingest, verify, seed, tokens)
│   └── smsparser/     # Template/regex SMS compiler
├── pkg/               # Reusable public libraries (importable by other services)
├── configs/           # Static config files
├── scripts/           # Build & dev scripts
├── bin/               # Compiled binaries (gitignored)
├── db/
│   ├── migrations/    # SQL schema migrations (*.up.sql / *.down.sql)
│   └── queries/       # sqlc query definitions
├── .env.example       # Environment variable template
├── Makefile           # Build / run / test automation
├── sqlc.yaml          # sqlc configuration
└── go.mod
```

## Getting Started

```powershell
# 1. Copy the env template and adjust values
Copy-Item .env.example .env

# 2. Run locally
go run ./cmd/api

# Or via Makefile
make run
```

The API listens on `PORT` from `.env` (default `8080`).

## Credentials

Three separate trust domains, all sent as `Authorization: Bearer <token>`:

| Credential | Format | Stored in | Unlocks | Scope |
| ---------- | ------ | --------- | ------- | ----- |
| **Merchant API key** | `vpk_…` | `api_keys` table (hashed) | `/api/v1/*` | One business — every request is tenant-scoped |
| **Device token** | `vdt_…` | `devices` table (hashed) | `/device/v1/*` | One phone — heartbeat + SMS upload only |
| **Management API key** | any string (`MANAGEMENT_API_KEY` env) | process env only (never in DB) | `/manage/v1/*` | Global — all businesses, admin surface used by Studio and the SDK |

Merchant keys and device tokens are issued via the Management API (plaintext shown exactly once) and can be revoked/deactivated. The Management API is **disabled entirely** when `MANAGEMENT_API_KEY` is unset.

## Endpoints

### Public

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/healthz` | Service health check (includes DB status) |
| GET | `/api/v1/ping` | Liveness ping |

### Merchant surface — `/api/v1` (api-key)

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST | `/orders` | Create an order (idempotent per `external_order_id`) |
| GET | `/orders/:external_order_id` | Fetch order by external ID |
| POST | `/orders/:external_order_id/verify` | Claim a TrxID against the order (rate-limited) |
| POST | `/providers` | Create a provider template (template or regex mode) |
| GET | `/providers` | List own + global builtin templates |
| GET | `/providers/:id` | Get one template |
| PUT | `/providers/:id/template` | Update template / direction / match mode / script |
| DELETE | `/providers/:id` | Deactivate a template |
| POST | `/providers/test` | Dry-run template or regex against a sample SMS |
| POST | `/devices/:device_id/calibrate-balance` | Record authoritative balance anchor |
| GET | `/devices/:device_id/balance?provider_id=` | Latest known balance point |

### Device surface — `/device/v1` (device-token)

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST | `/heartbeat` | Device liveness ping (optional `app_version` / `os_version`) |
| POST | `/messages` | Batch-ingest SMS messages (1–50 per request) |

### Management surface — `/manage/v1` (management key; global scope)

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/features` | Feature flags (unsafe scripts, script timeout) |
| GET | `/businesses` | List businesses (status/search filters, paginated) |
| POST | `/businesses` | Create a business |
| GET | `/businesses/:business_id` | Get one business |
| PATCH | `/businesses/:business_id/status` | Suspend / activate |
| GET | `/businesses/:business_id/api-keys` | List merchant keys (hashes never returned) |
| POST | `/businesses/:business_id/api-keys` | Issue merchant key (**plaintext shown once**) |
| DELETE | `/api-keys/:key_id` | Revoke a merchant key |
| GET | `/devices` | List all devices (+ derived online status) |
| POST | `/businesses/:business_id/devices` | Register a device (**token shown once**) |
| DELETE | `/devices/:device_id` | Deactivate a device |
| GET | `/orders` | All orders (business/status filters, paginated) |
| GET | `/transactions` | All transactions (business/provider/direction filters) |
| GET | `/attempts` | Verification-attempt audit log (result/trx filters) |
| GET | `/messages` | Raw SMS inbox (parse-status filter — debugging view) |
| GET | `/stats` | Dashboard aggregates |
| GET | `/providers` | All templates incl. global builtins |
| POST | `/providers` | Create (omit `business_id` → global) |
| PUT | `/providers/:id/template` | Update any template |
| DELETE | `/providers/:id` | Deactivate any template |
| POST | `/providers/test` | Same tester, management scope |
| POST | `/devices/:device_id/calibrate-balance` | Calibrate any device |
| GET | `/devices/:device_id/balance?provider_id=` | Balance of any device |

List endpoints accept `limit` (max 100) and `offset`.

## Provider templates & directions

Each provider template declares a `direction`:

- `credit` (default) — money **received** (customer payments). Only credit transactions are claimable against orders.
- `debit` — money **leaving** the account (cash-out, send money). Debits are recorded to keep the device balance trail complete, but a debit TrxID submitted at `/verify` is rejected with `wrong_direction`.

Create one provider per SMS format your account sends — e.g. "bKash Receive" (`credit`) and "bKash CashOut" (`debit`). Recording debits is what keeps balance verification accurate: without them, any cash-out between two deposits would look like a broken chain.

Balance verification uses arithmetic continuity, not equality: for candidate transaction `T` with previous known balance `P` on the same device+provider, the expected post-transaction balance is `P + T.amount` (credit) or `P − T.amount` (debit), and it must equal the balance stated in the SMS. Missing balances skip the check (verdict `null`); a contradicted balance rejects with `balance_mismatch`. Trails are independent per device+provider, so one phone carrying multiple SIMs keeps separate chains.

> **Watch out for shadowing:** if two active templates can match the same SMS, the earliest-created one wins silently. Deactivate superseded templates after editing.

### Regex mode (`match_mode: "regex"`)

When template literals are too rigid (variable fee lines, promo text, changing formats), set `"match_mode": "regex"` on a provider and write a raw RE2 pattern using the same named groups:

```
You have received Tk (?P<amount>[0-9,.]+) from (?P<sender>\+?[0-9]+)\..*?Balance: Tk (?P<balance>[0-9,.]+)\. TrxID (?P<trxId>[A-Za-z0-9]{6,20})
```

Rules enforced server-side:

- Only the named groups `amount`, `sender`, `trxId`, `balance` are allowed; **`amount` and `trxId` are required** in every pattern
- Pattern must compile under Go's RE2 engine — lookaheads/backreferences are rejected at save time with the parser error
- Max 1024 chars; matching is case-insensitive (`(?i)` is prepended automatically)
- SMS bodies are whitespace-collapsed before matching; captured amounts go through the same comma/Bengali-digit normalization as template mode

Regex mode is safe to host because RE2 guarantees linear-time matching (no catastrophic backtracking). Always validate patterns against real samples via `POST /api/v1/providers/test` before saving.

### Custom logic (provider `script`)

Optionally attach a JavaScript script to a provider. It runs after each successful match, in a sandboxed [goja](https://github.com/dop251/goja) runtime (100ms budget, no network/files/dates/random):

```javascript
if (amount < 10) reject("dust transaction");

return {
  amount: amount - 15,                    // net → stored in effective_amount, used for order matching
  sender: sender.replace("+88", "0"),     // normalisation
  meta: { gross: fixed(amount) }          // free-form extras stored as JSONB
};
```

- Inputs: `amount` (number|null), `sender`, `trxId`, `balance` (number|null), `body`, `direction`, `providerName`
- Builtins: `round(x,dp)` · `abs` · `min` · `max` · `floor` · `ceil` · `lower` · `upper` · `trim` · `fixed(x)` · `reject(reason)`
- Returning `amount` sets `effective_amount` (what order matching compares); the **raw bank amount still feeds balance-chain verification**
- `reject("reason")` skips the message entirely — it appears in the inbox as `skipped`
- Scripts cannot rewrite `trxId` or stated `balance` unless `ALLOW_UNSAFE_SCRIPTS=true`
- Regular expressions are unavailable inside scripts (anti-ReDoS measure); caps: 4096-char script, results validated and clamped

### Balance calibration

If the device missed SMS (network outage, dead battery, parse failures), the recorded trail drifts from reality and honest payments start failing `balance_mismatch`. Fix it:

1. `GET /api/v1/devices/:device_id/balance` - shows the latest known balance point and its source (`transaction` or `calibration`)
2. Check the real balance in your MFS app
3. `POST /api/v1/devices/:device_id/calibrate-balance` with `{"balance": "4300", "note": "missed SMS during outage"}`

Calibrations act as authoritative anchors: future payments chain arithmetically from them, and a **stuck** transaction (rejected due to drift, with no other transactions recorded after it) is rescued on retry when its stated balance equals the latest calibration.

Balance trails are scoped per **device + provider** (i.e., per MFS account). After confirming a fraudulent SMS, recalibrate the affected device+provider so its poisoned balance point doesn't cascade into future rejections.

## Known limitations

- Matching is leftmost-match-wins: an SMS containing multiple transactions records only the first parsed transaction.
- Shared personal numbers used across businesses resolve to whichever business first ingested the transaction.
- Sender-ID spoofing remains a documented weakness of the SMS protocol; sender gates are best-effort only.
- Seeded provider templates (bKash, Nagad, Rocket, Upay) are best-effort defaults and can be edited per deployment.
- Rejected (fraudulent) transactions keep their recorded balance point in the trail — recalibrate after confirmed fraud.

## Environment Variables

See [.env.example](.env.example).

| Variable | Description | Default |
| -------- | ----------- | ------- |
| APP_NAME | Service name | vindrapay-go |
| PORT | HTTP port | 8080 |
| APP_ENV | Runtime environment (`development`, `production`) | development |
| DATABASE_URL | Postgres connection string | - |
| RATE_LIMIT_MAX_ATTEMPTS | Max verification attempts per business within the window before 429 | 10 |
| RATE_LIMIT_WINDOW_SECONDS | Sliding window (seconds) for the rate limit check | 60 |
| SCRIPT_TIMEOUT_MS | Wall-clock budget per custom-logic script execution, clamped to 10..1000 | 100 |
| ALLOW_UNSAFE_SCRIPTS | When false, provider scripts cannot override `trxId`/`balance` (attempts are dropped and reported) | false |
| MANAGEMENT_API_KEY | Enables `/manage/v1/*` when set; required by Studio and the SDK | - (disabled) |

## Database (sqlc + pgx)

Postgres access uses [sqlc](https://docs.sqlc.dev): you write SQL in `db/queries/`, and sqlc
generates fully typed Go code into `internal/db/`. The app connects via a
[pgx](https://github.com/jackc/pgx) connection pool configured by `DATABASE_URL`.

Workflow:

```bash
# 1. Change the schema (db/migrations) or add queries (db/queries)
# 2. Regenerate the Go code
make sqlc          # or: sqlc generate

# 3. Use it in code
import db "vindrapay-go/internal/db"

q := db.New(pool)
biz, err := q.CreateBusiness(ctx, db.CreateBusinessParams{
    Name:       "My Shop",
    OwnerEmail: "owner@example.com",
})
```

> Note: generated code is committed so builds never require the sqlc CLI.
> Migrations live in `db/migrations` (apply with golang-migrate or psql); the app
> fails fast at startup if the database is unreachable.

## Building for Linux

Cross-compilation is CGO-free and fully static, so the binary runs on any Linux distro / container.

**Linux/macOS (Make):**

```bash
make build-linux      # -> bin/vindrapay-go-linux-amd64
make build-all        # windows + linux
make help             # list all targets
```

**Windows (PowerShell script):**

```powershell
./scripts/build.ps1                          # linux/amd64 by default
./scripts/build.ps1 -Target linux -Arch arm64
./scripts/build.ps1 -Target windows
```

Or manually:

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o bin/vindrapay-go-linux-amd64 ./cmd/api
```
