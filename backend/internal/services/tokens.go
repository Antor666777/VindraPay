package services

import (
	"crypto/rand"
	"encoding/hex"

	"vindrapay-go/internal/middleware"
)

const tokenRandomBytes = 24

func GenerateToken(kindPrefix string) (token, prefix, hash string) {
	raw := make([]byte, tokenRandomBytes)
	_, _ = rand.Read(raw)

	token = kindPrefix + "_" + hex.EncodeToString(raw)
	prefix = token[:8]
	hash = middleware.HashToken(token)
	return token, prefix, hash
}
