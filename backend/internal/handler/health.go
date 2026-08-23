package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"vindrapay-go/internal/config"
)

const dbPingTimeout = 2 * time.Second

type HealthHandler struct {
	cfg *config.Config
	db  *pgxpool.Pool
}

func NewHealthHandler(cfg *config.Config, db *pgxpool.Pool) *HealthHandler {
	return &HealthHandler{cfg: cfg, db: db}
}

// Ping handles GET /api/v1/ping
func (h *HealthHandler) Ping(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Hello, World!",
	})
}

// Health handles GET /healthz
func (h *HealthHandler) Health(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), dbPingTimeout)
	defer cancel()

	dbStatus := "up"
	httpStatus := http.StatusOK
	if err := h.db.Ping(ctx); err != nil {
		dbStatus = "down"
		httpStatus = http.StatusServiceUnavailable
	}

	c.JSON(httpStatus, gin.H{
		"success": dbStatus == "up",
		"app":     h.cfg.AppName,
		"env":     h.cfg.Env,
		"db":      dbStatus,
		"time":    time.Now().UTC().Format(time.RFC3339),
	})
}
