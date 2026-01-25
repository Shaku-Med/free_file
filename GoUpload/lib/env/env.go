package env

import (
	"os"
	"strconv"
	"strings"
)

func EnvValidator(key string) string {
	if val, ok := os.LookupEnv(key); ok && val != "" {
		return val
	}
	return ""
}

func Get(key, fallback string) string {
	if val := EnvValidator(key); val != "" {
		return val
	}
	return fallback
}

func GetInt64(key string, fallback int64) int64 {
	val := EnvValidator(key)
	if val == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func IsDev() bool {
	return normalize(EnvValidator("APP_ENV")) == "development" || normalize(EnvValidator("APP_ENV")) == "dev"
}

func IsProd() bool {
	return normalize(EnvValidator("APP_ENV")) == "production" || normalize(EnvValidator("APP_ENV")) == "prod"
}

func normalize(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
