package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"vindrapay-go/internal/config"
)

const (
	maxConns       = 10
	minConns       = 2
	connMaxLife    = time.Hour
	connMaxIdle    = 30 * time.Minute
	connectTimeout = 5 * time.Second
)

func NewPostgres(ctx context.Context, cfg *config.Config) (*pgxpool.Pool, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}

	poolCfg.MaxConns = maxConns
	poolCfg.MinConns = minConns
	poolCfg.MaxConnLifetime = connMaxLife
	poolCfg.MaxConnIdleTime = connMaxIdle

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return pool, nil
}
