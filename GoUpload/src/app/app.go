package app

import (
	"net/http"
	"time"

	"goupload/lib/env"
	"goupload/lib/logger"
	"goupload/lib/upload"
	"goupload/src/middleware"
	"goupload/src/routes"
)

func New() (http.Handler, error) {
	// 10 GiB default; override with MAX_UPLOAD_BYTES env
	maxSize := env.GetInt64("MAX_UPLOAD_BYTES", 10<<30)
	uploader := upload.NewService(maxSize, 15*time.Minute)
	log := logger.New(2048)
	router := routes.NewRouter(uploader)
	handler := middleware.Default(router, log)
	return handler, nil
}
