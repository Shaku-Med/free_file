package handlers

import (
	"errors"
	"net/http"

	"livestream/internal/models"
	"livestream/internal/services"
	"livestream/lib"
)

type WebRTCHandler struct {
	service services.StreamService
}

func NewWebRTCHandler(service services.StreamService) *WebRTCHandler {
	return &WebRTCHandler{service: service}
}

func (h *WebRTCHandler) WHIP(w http.ResponseWriter, r *http.Request) {
	streamKey := r.PathValue("streamKey")
	if !lib.IsValidID(streamKey) {
		lib.Error(w, http.StatusBadRequest, "invalid stream key")
		return
	}

	if err := h.service.AuthenticateKey(r.Context(), streamKey); err != nil {
		if errors.Is(err, models.ErrUnauthorized) {
			lib.Error(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		lib.Error(w, http.StatusInternalServerError, "internal error")
		return
	}

	offer, err := lib.ReadBody(r)
	if err != nil {
		lib.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	resp, err := h.service.ProxyWHIP(r.Context(), streamKey, offer, r.Header.Get("Content-Type"))
	if err != nil {
		lib.Error(w, http.StatusBadGateway, "upstream error")
		return
	}

	writeWebRTCResponse(w, resp)
}

func (h *WebRTCHandler) WHEP(w http.ResponseWriter, r *http.Request) {
	streamKey := r.PathValue("streamKey")
	if !lib.IsValidID(streamKey) {
		lib.Error(w, http.StatusBadRequest, "invalid stream key")
		return
	}

	if err := h.service.AuthenticateKey(r.Context(), streamKey); err != nil {
		if errors.Is(err, models.ErrUnauthorized) {
			lib.Error(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		lib.Error(w, http.StatusInternalServerError, "internal error")
		return
	}

	offer, err := lib.ReadBody(r)
	if err != nil {
		lib.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	resp, err := h.service.ProxyWHEP(r.Context(), streamKey, offer, r.Header.Get("Content-Type"))
	if err != nil {
		lib.Error(w, http.StatusBadGateway, "upstream error")
		return
	}

	writeWebRTCResponse(w, resp)
}

func (h *WebRTCHandler) GetStreamType(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !lib.IsValidID(id) {
		lib.Error(w, http.StatusBadRequest, "invalid stream id")
		return
	}

	info, err := h.service.GetStreamType(r.Context(), id)
	if err != nil {
		if errors.Is(err, models.ErrStreamNotFound) {
			lib.Error(w, http.StatusNotFound, "stream not found")
			return
		}
		lib.Error(w, http.StatusInternalServerError, "internal error")
		return
	}

	lib.JSON(w, http.StatusOK, info)
}

// writeWebRTCResponse forwards MediaMTX's WHIP/WHEP response to the client.
// Location header must be preserved  the browser uses it for ICE trickle and session teardown.
func writeWebRTCResponse(w http.ResponseWriter, resp *models.WebRTCProxyResponse) {
	if resp.Location != "" {
		w.Header().Set("Location", resp.Location)
	}
	if resp.ETag != "" {
		w.Header().Set("ETag", resp.ETag)
	}
	if resp.ContentType != "" {
		w.Header().Set("Content-Type", resp.ContentType)
	}
	w.Header().Set("Access-Control-Expose-Headers", "Location, ETag")
	w.WriteHeader(resp.StatusCode)
	w.Write(resp.Body)
}
