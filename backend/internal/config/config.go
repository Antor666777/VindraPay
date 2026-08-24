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

	ManagementAPIKey string

	RateLimitMaxAttempts   int
	RateLimitWindowSeconds int

	ScriptTimeoutMs    int
	AllowUnsafeScripts bool
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

		ManagementAPIKey: getEnv("MANAGEMENT_API_KEY", ""),

		RateLimitMaxAttempts:   getIntEnv("RATE_LIMIT_MAX_ATTEMPTS", 10),
		RateLimitWindowSeconds: getIntEnv("RATE_LIMIT_WINDOW_SECONDS", 60),

		ScriptTimeoutMs:    getClampedIntEnv("SCRIPT_TIMEOUT_MS", 100, 10, 1000),
		AllowUnsafeScripts: getBool("ALLOW_UNSAFE_SCRIPTS", false),
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

func getClampedIntEnv(key string, fallback, min, max int) int {
	n := getIntEnv(key, fallback)
	if n < min {
		return min
	}
	if n > max {
		return max
	}
	return n
}

func getBool(key string, fallback bool) bool {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return b
}
