package middleware

import (
	"context"
	"crypto/subtle"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	db "vindrapay-go/internal/db"
)

const lastUsedWriteInterval = 60 * time.Second

var (
	lastUsedWrites   = make(map[uuid.UUID]time.Time)
	lastUsedWritesMu sync.Mutex
)

type apiKeyCandidate struct {
	ID         uuid.UUID
	BusinessID uuid.UUID
	KeyHash    string
	RevokedAt  pgtype.Timestamptz
}

func APIKeyAuth(q *db.Queries) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, ok := bearerToken(c)
		if !ok {
			unauthorized(c)
			return
		}

		rows, err := q.ListApiKeysByPrefix(c.Request.Context(), tokenPrefix(token))
		if err != nil {
			unauthorized(c)
			return
		}

		candidates := make([]apiKeyCandidate, 0, len(rows))
		for _, r := range rows {
			candidates = append(candidates, apiKeyCandidate{
				ID:         r.ID,
				BusinessID: r.BusinessID,
				KeyHash:    r.KeyHash,
				RevokedAt:  r.RevokedAt,
			})
		}

		hash := HashToken(token)
		for _, key := range candidates {
			if subtle.ConstantTimeCompare([]byte(hash), []byte(key.KeyHash)) != 1 {
				continue
			}

			if key.RevokedAt.Valid {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "error": "api key revoked"})
				return
			}

			c.Set("business_id", key.BusinessID)
			touchLastUsed(q, c.Request.Context(), key.ID)
			c.Next()
			return
		}

		unauthorized(c)
	}
}

func touchLastUsed(q *db.Queries, ctx context.Context, id uuid.UUID) {
	now := time.Now()
	lastUsedWritesMu.Lock()
	if last, ok := lastUsedWrites[id]; ok && now.Sub(last) < lastUsedWriteInterval {
		lastUsedWritesMu.Unlock()
		return
	}
	lastUsedWrites[id] = now
	lastUsedWritesMu.Unlock()

	go func() {
		writeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = q.TouchApiKeyLastUsed(writeCtx, id)
	}()
}
