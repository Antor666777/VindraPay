package middleware

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	db "vindrapay-go/internal/db"
)

func RateLimit(q *db.Queries, maxAttempts int, windowSeconds int) gin.HandlerFunc {
	return func(c *gin.Context) {
		businessID, ok := BusinessIDFromContext(c)
		if !ok {
			c.Next()
			return
		}

		count, err := q.CountRecentAttemptsByBusiness(c.Request.Context(), db.CountRecentAttemptsByBusinessParams{
			BusinessID:    businessID,
			WindowSeconds: int32(windowSeconds),
		})
		if err != nil {
			log.Printf("rate limit check failed: %v", err)
			c.Next()
			return
		}

		if count >= int64(maxAttempts) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"success": false, "error": "rate limit exceeded"})
			return
		}

		c.Next()
	}
}
