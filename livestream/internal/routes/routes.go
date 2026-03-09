package routes

import (
	"net/http"

	"livestream/internal/handlers"
	"livestream/internal/middleware"
	"livestream/lib"
)

func Register(stream *handlers.StreamHandler, webrtc *handlers.WebRTCHandler) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		lib.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("POST /stream/auth", stream.Authenticate)
	mux.HandleFunc("POST /stream/start", stream.Start)
	mux.HandleFunc("POST /stream/end", stream.End)
	mux.HandleFunc("GET /stream/{id}", stream.GetStream)
	mux.HandleFunc("GET /stream/{id}/viewers", stream.GetViewers)
	mux.HandleFunc("GET /stream/{id}/type", webrtc.GetStreamType)
	mux.HandleFunc("POST /stream/{id}/ban/{userId}", stream.BanUser)

	mux.HandleFunc("POST /stream/whip/{streamKey}", webrtc.WHIP)
	mux.HandleFunc("POST /stream/whep/{streamKey}", webrtc.WHEP)

	var handler http.Handler = mux
	handler = middleware.Recovery(handler)
	handler = middleware.Logging(handler)

	return handler
}
