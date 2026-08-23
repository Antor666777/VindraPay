package config

import (
	"log"
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

type Config struct {
	AppName     string
	Port        string
	Env         string
	DatabaseURL string

	RateLimitMaxAttempts   int
	RateLimitWindowSeconds int
}

func Load() (*Config, error) {
	if err := godotenv.Load(); err != nil {
		log.Println("no .env file found, falling back to OS environment")
	}

	return &Config{
		AppName:     getEnv("APP_NAME", "vindrapay-go"),
		Port:        getEnv("PORT", "8080"),
		Env:         getEnv("APP_ENV", "development"),
		DatabaseURL: getEnv("DATABASE_URL", ""),

		RateLimitMaxAttempts:   getIntEnv("RATE_LIMIT_MAX_ATTEMPTS", 10),
		RateLimitWindowSeconds: getIntEnv("RATE_LIMIT_WINDOW_SECONDS", 60),
	}, nil
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func getIntEnv(key string, fallback int) int {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}
