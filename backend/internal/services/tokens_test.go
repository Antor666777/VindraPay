package services

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"
	"testing"

	"vindrapay-go/internal/middleware"
)

var tokenSuffixPattern = regexp.MustCompile(`^[0-9a-f]{48}$`)

func TestGenerateTokenPrefixes(t *testing.T) {
	for _, kind := range []string{"vpk", "vdt"} {
		token, prefix, hash := GenerateToken(kind)

		if !strings.HasPrefix(token, kind+"_") {
			t.Fatalf("token %q does not start with %q", token, kind+"_")
		}

		parts := strings.SplitN(token, "_", 2)
		if len(parts) != 2 {
			t.Fatalf("token %q is malformed", token)
		}
		if !tokenSuffixPattern.MatchString(parts[1]) {
			t.Fatalf("token suffix %q is not 48 lowercase hex chars", parts[1])
		}

		if prefix != token[:8] {
			t.Fatalf("prefix = %q, want %q", prefix, token[:8])
		}

		sum := sha256.Sum256([]byte(token))
		if hash != hex.EncodeToString(sum[:]) {
			t.Fatalf("hash mismatch for token %q", token)
		}
		if hash != middleware.HashToken(token) {
			t.Fatalf("hash does not match middleware.HashToken for token %q", token)
		}
	}
}

func TestGenerateTokenUniqueness(t *testing.T) {
	seen := make(map[string]struct{}, 50)
	for i := 0; i < 50; i++ {
		token, _, _ := GenerateToken("vpk")
		if _, dup := seen[token]; dup {
			t.Fatalf("duplicate token generated: %s", token)
		}
		seen[token] = struct{}{}
	}
}
