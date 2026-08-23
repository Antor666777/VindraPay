package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	db "vindrapay-go/internal/db"
)

const bearerPrefix = "Bearer "

func bearerToken(c *gin.Context) (string, bool) {
	header := c.GetHeader("Authorization")
	if len(header) <= len(bearerPrefix) || !strings.EqualFold(header[:len(bearerPrefix)], bearerPrefix) {
		return "", false
	}
	token := strings.TrimSpace(header[len(bearerPrefix):])
	if token == "" {
		return "", false
	}
	return token, true
}

func tokenPrefix(token string) string {
	return token[:min(8, len(token))]
}

func unauthorized(c *gin.Context) {
	c.AbortWithStatusJSON(401, gin.H{"success": false, "error": "unauthorized"})
}

func BusinessIDFromContext(c *gin.Context) (uuid.UUID, bool) {
	v, ok := c.Get("business_id")
	if !ok {
		return uuid.Nil, false
	}
	businessID, ok := v.(uuid.UUID)
	return businessID, ok
}

func DeviceFromContext(c *gin.Context) (db.Device, bool) {
	v, ok := c.Get("device")
	if !ok {
		return db.Device{}, false
	}
	dev, ok := v.(db.Device)
	return dev, ok
}
