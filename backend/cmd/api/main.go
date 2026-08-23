package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"vindrapay-go/internal/config"
	"vindrapay-go/internal/database"
	db "vindrapay-go/internal/db"
	"vindrapay-go/internal/router"
	"vindrapay-go/internal/services"
)

const (
	shutdownTimeout = 10 * time.Second
	sweepInterval   = 60 * time.Second
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("%v", err)
	}
	log.Println("server stopped cleanly")
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := database.NewPostgres(ctx, cfg)
	if err != nil {
		return err
	}
	defer pool.Close()
	log.Println("connected to postgres")

	q := db.New(pool)

	if err := services.NewSeeder(q).SeedBuiltins(ctx); err != nil {
		log.Fatalf("seed builtin providers: %v", err)
	}
	log.Println("builtin providers seeded")

	go func() {
		ticker := time.NewTicker(sweepInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				count, err := q.ExpireStaleOrders(ctx)
				if err != nil {
					if ctx.Err() != nil {
						return
					}
					log.Printf("expire stale orders: %v", err)
					continue
				}
				if count > 0 {
					log.Printf("expired %d stale order(s)", count)
				}
			}
		}
	}()

	r := router.Setup(cfg, pool, q)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadTimeout:       10 * time.Second,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Printf("%s starting on port %s [%s]", cfg.AppName, cfg.Port, cfg.Env)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case <-ctx.Done():
		log.Println("shutting down...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	case err := <-errCh:
		return err
	}
}
