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
│   ├── middleware/    # Gin middleware
│   ├── model/         # Domain models / entities
│   ├── router/        # Route registration
│   └── service/       # Business logic
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

### Endpoints

Authenticated routes expect `Authorization: Bearer <token>` — an **api key** for `/api/v1` routes, a **device token** for `/device/v1` routes.

| Method | Path                                    | Auth          | Description                                                        |
| ------ | --------------------------------------- | ------------- | ------------------------------------------------------------------ |
| GET    | `/healthz`                              | none          | Service health check                                               |
| POST   | `/api/v1/orders`                        | api-key       | Create an order (idempotent per `external_order_id`)                |
| GET    | `/api/v1/orders/:external_order_id`     | api-key       | Fetch an order by external ID                                       |
| POST   | `/api/v1/orders/:external_order_id/verify` | api-key    | Verify a payment against an order (`{"trx_id": "..."}`)             |
| POST   | `/device/v1/messages`                   | device-token  | Batch-ingest SMS messages (1–50 per request) from a registered device |
| POST   | `/device/v1/heartbeat`                  | device-token  | Device liveness ping (optional `app_version` / `os_version`)        |

## Provider templates & directions

Each provider template declares a `direction`:

- `credit` (default) — money **received** (customer payments). Only credit transactions are claimable against orders.
- `debit` — money **leaving** the account (cash-out, send money). Debits are recorded to keep the device balance trail complete, but a debit TrxID submitted at `/verify` is rejected with `wrong_direction`.

Create one provider per SMS format your account sends — e.g. "bKash Receive" (`credit`) and "bKash CashOut" (`debit`). Recording debits is what keeps balance verification accurate: without them, any cash-out between two deposits would look like a broken chain.

Balance verification uses arithmetic continuity, not equality: for candidate transaction `T` with previous known balance `P` on the same device, the expected post-transaction balance is `P + T.amount` (credit) or `P − T.amount` (debit), and it must equal the balance stated in the SMS. Missing balances skip the check (verdict `null`); a contradicted balance rejects with `balance_mismatch`.

> **Watch out for shadowing:** if two active templates can match the same SMS, the earliest-created one wins silently. Deactivate superseded templates after editing.

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

### Balance calibration

If the device missed SMS (network outage, dead battery, parse failures), the recorded trail drifts from reality and honest payments start failing `balance_mismatch`. Fix it:

1. `GET /api/v1/devices/:device_id/balance` - shows the latest known balance point and its source (`transaction` or `calibration`)
2. Check the real balance in your MFS app
3. `POST /api/v1/devices/:device_id/calibrate-balance` with `{"balance": "4300", "note": "missed SMS during outage"}`

Calibrations act as authoritative anchors: future payments chain arithmetically from them, and a **stuck** transaction (rejected due to drift, with no other transactions recorded after it) is rescued on retry when its stated balance equals the latest calibration.

Balance trails are scoped per **device + provider** (i.e., per MFS account), so one phone carrying multiple SIMs keeps independent chains. After confirming a fraudulent SMS, recalibrate the affected device+provider so its poisoned balance point doesn't cascade into future rejections.

## Known limitations

- Matching is leftmost-match-wins: an SMS containing multiple transactions records only the first parsed transaction.
- Shared personal numbers used across businesses resolve to whichever business first ingested the transaction.
- Sender-ID spoofing remains a documented weakness of the SMS protocol; sender gates are best-effort only.
- Seeded provider templates (bKash, Nagad, Rocket, Upay) are best-effort defaults and can be edited per deployment.

## Environment Variables

See [.env.example](.env.example).

| Variable  | Description                              | Default       |
| --------- | ---------------------------------------- | ------------- |
| APP_NAME  | Service name                             | vindrapay-go  |
| PORT      | HTTP port                                | 8080          |
| APP_ENV   | Runtime environment (`development` etc.) | development   |
| DATABASE_URL | Postgres connection string           | -             |
| RATE_LIMIT_MAX_ATTEMPTS | Max verification attempts per business within the window before 429 | 10 |
| RATE_LIMIT_WINDOW_SECONDS | Sliding window (seconds) for the rate limit check | 60 |

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
> Migrations are applied with a migration tool (e.g. golang-migrate); the app
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
