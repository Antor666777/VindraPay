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

| Method | Path             | Description              |
| ------ | ---------------- | ------------------------ |
| GET    | `/healthz`       | Service health check     |
| GET    | `/api/v1/ping`   | Hello world              |

```bash
curl http://localhost:8080/api/v1/ping
# {"message":"Hello, World!","success":true}
```

## Environment Variables

See [.env.example](.env.example).

| Variable  | Description                              | Default       |
| --------- | ---------------------------------------- | ------------- |
| APP_NAME  | Service name                             | vindrapay-go  |
| PORT      | HTTP port                                | 8080          |
| APP_ENV   | Runtime environment (`development` etc.) | development   |
| DATABASE_URL | Postgres connection string           | -             |

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
