package middleware

import (
	"crypto/subtle"
	"net/http"

	"github.com/gin-gonic/gin"

	"vindrapay-go/internal/config"
)

func ManagementAuth(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg == nil || cfg.ManagementAPIKey == "" {
			notFound(c)
			return
		}

		token, ok := bearerToken(c)
		if !ok {
			notFound(c)
			return
		}

		hash := HashToken(token)
		if subtle.ConstantTimeCompare([]byte(hash), []byte(HashToken(cfg.ManagementAPIKey))) != 1 {
			unauthorized(c)
			return
		}

		c.Next()
	}
}

func notFound(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"success": false, "error": "not found"})
}
