package router

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"vindrapay-go/internal/config"
	"vindrapay-go/internal/handler"
)

func Setup(cfg *config.Config, db *pgxpool.Pool) *gin.Engine {
	if cfg.Env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.Default()

	health := handler.NewHealthHandler(cfg, db)

	r.GET("/healthz", health.Health)

	v1 := r.Group("/api/v1")
	{
		v1.GET("/ping", health.Ping)
	}

	r.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "route not found",
		})
	})

	return r
}
