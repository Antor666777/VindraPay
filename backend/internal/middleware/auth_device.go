package middleware

import (
	"crypto/subtle"

	"github.com/gin-gonic/gin"

	db "vindrapay-go/internal/db"
)

func DeviceAuth(q *db.Queries) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, ok := bearerToken(c)
		if !ok {
			unauthorized(c)
			return
		}

		devices, err := q.GetDeviceByTokenPrefix(c.Request.Context(), tokenPrefix(token))
		if err != nil || len(devices) == 0 {
			unauthorized(c)
			return
		}

		hash := HashToken(token)
		for _, dev := range devices {
			if subtle.ConstantTimeCompare([]byte(hash), []byte(dev.TokenHash)) == 1 {
				c.Set("device", dev)
				c.Next()
				return
			}
		}

		unauthorized(c)
	}
}
