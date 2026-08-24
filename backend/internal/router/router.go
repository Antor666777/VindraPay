package router

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"vindrapay-go/internal/config"
	db "vindrapay-go/internal/db"
	"vindrapay-go/internal/handler"
	"vindrapay-go/internal/handlers"
	"vindrapay-go/internal/middleware"
	"vindrapay-go/internal/services"
)

func Setup(cfg *config.Config, pool *pgxpool.Pool, q *db.Queries) *gin.Engine {
	if cfg.Env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.Default()
	_ = r.SetTrustedProxies(nil)
	r.Use(limitRequestBody())

	health := handler.NewHealthHandler(cfg, pool)

	r.GET("/healthz", health.Health)
	r.GET("/api/v1/ping", health.Ping)

	scriptOpts := services.ScriptOptions{
		TimeoutMs:   cfg.ScriptTimeoutMs,
		AllowUnsafe: cfg.AllowUnsafeScripts,
	}

	orderHandler := handlers.NewOrderHandler(q, services.NewVerifyService(q))
	deviceHandler := handlers.NewDeviceHandler(q, services.NewIngestService(q, scriptOpts))
	providerHandler := handlers.NewProviderHandler(q, scriptOpts)

	api := r.Group("/api/v1", middleware.APIKeyAuth(q))
	{
		api.POST("/orders", orderHandler.Create)
		api.GET("/orders/:external_order_id", orderHandler.Get)
		api.POST("/orders/:external_order_id/verify",
			middleware.RateLimit(q, cfg.RateLimitMaxAttempts, cfg.RateLimitWindowSeconds),
			orderHandler.Verify,
		)
		api.POST("/providers", providerHandler.Create)
		api.GET("/providers", providerHandler.List)
		api.GET("/providers/:id", providerHandler.Get)
		api.PUT("/providers/:id/template", providerHandler.UpdateTemplate)
		api.DELETE("/providers/:id", providerHandler.Deactivate)
		api.POST("/providers/test", providerHandler.Test)
		api.POST("/devices/:device_id/calibrate-balance", deviceHandler.CalibrateBalance)
		api.GET("/devices/:device_id/balance", deviceHandler.DeviceBalance)
	}

	dev := r.Group("/device/v1", middleware.DeviceAuth(q))
	{
		dev.POST("/heartbeat", deviceHandler.Heartbeat)
		dev.POST("/messages", deviceHandler.Messages)
	}

	if cfg.ManagementAPIKey != "" {
		mgmt := r.Group("/manage/v1", middleware.ManagementAuth(cfg))
		manageHandler := handlers.NewManageHandler(q, scriptOpts)
		{
			mgmt.GET("/features", manageHandler.Features)
			mgmt.GET("/businesses", manageHandler.ListBusinesses)
			mgmt.POST("/businesses", manageHandler.CreateBusiness)
			mgmt.GET("/businesses/:business_id", manageHandler.GetBusiness)
			mgmt.PATCH("/businesses/:business_id/status", manageHandler.SetBusinessStatus)
			mgmt.GET("/businesses/:business_id/api-keys", manageHandler.ListApiKeys)
			mgmt.POST("/businesses/:business_id/api-keys", manageHandler.CreateApiKey)
			mgmt.DELETE("/api-keys/:key_id", manageHandler.RevokeApiKey)
			mgmt.GET("/devices", manageHandler.ListDevices)
			mgmt.POST("/businesses/:business_id/devices", manageHandler.CreateDevice)
			mgmt.DELETE("/devices/:device_id", manageHandler.DeactivateDevice)
			mgmt.GET("/orders", manageHandler.ListOrders)
			mgmt.GET("/transactions", manageHandler.ListTransactions)
			mgmt.GET("/attempts", manageHandler.ListAttempts)
			mgmt.GET("/messages", manageHandler.ListMessages)
			mgmt.GET("/stats", manageHandler.Stats)
			mgmt.GET("/providers", manageHandler.ListProviders)
			mgmt.POST("/providers", manageHandler.CreateProvider)
			mgmt.PUT("/providers/:id/template", manageHandler.UpdateProviderTemplate)
			mgmt.DELETE("/providers/:id", manageHandler.DeactivateProvider)
			mgmt.POST("/providers/test", providerHandler.Test)
			mgmt.POST("/devices/:device_id/calibrate-balance", manageHandler.CalibrateBalance)
			mgmt.GET("/devices/:device_id/balance", manageHandler.DeviceBalance)
		}
	}

	r.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "route not found",
		})
	})

	return r
}

const maxRequestBodyBytes = 1 << 20

func limitRequestBody() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxRequestBodyBytes)
		c.Next()
	}
}
