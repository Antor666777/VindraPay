package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	AppName     string
	Port        string
	Env         string
	DatabaseURL string
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
	}, nil
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
