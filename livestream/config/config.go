package config

import (
	"os"
	"time"
)

type Config struct {
	Port            string
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	IdleTimeout     time.Duration
	ShutdownTimeout time.Duration
	MediaMTXURL     string
}

func Load() *Config {
	port := os.Getenv("LIVESTREAM_PORT")
	if port == "" {
		port = "3005"
	}

	mediamtxURL := os.Getenv("MEDIAMTX_URL")
	if mediamtxURL == "" {
		mediamtxURL = "http://localhost:8889"
	}

	return &Config{
		Port:            port,
		ReadTimeout:     15 * time.Second,
		WriteTimeout:    15 * time.Second,
		IdleTimeout:     60 * time.Second,
		ShutdownTimeout: 10 * time.Second,
		MediaMTXURL:     mediamtxURL,
	}
}
