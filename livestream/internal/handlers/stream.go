package handlers

import (
	"errors"
	"net/http"

	"livestream/internal/models"
	"livestream/internal/services"
	"livestream/lib"
)

type StreamHandler struct {
	service services.StreamService
}

func NewStreamHandler(service services.StreamService) *StreamHandler {
	return &StreamHandler{service: service}
}

func (h *StreamHandler) Authenticate(w http.ResponseWriter, r *http.Request) {
	var req models.AuthRequest
	if err := lib.DecodeJSON(r, &req); err != nil {
		lib.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.Path = lib.SanitizeString(req.Path)
	req.User = lib.SanitizeString(req.User)

	if err := h.service.Authenticate(r.Context(), &req); err != nil {
		if errors.Is(err, models.ErrUnauthorized) {
			lib.Error(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		lib.Error(w, http.StatusInternalServerError, "internal error")
		return
	}

	lib.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *StreamHandler) Start(w http.ResponseWriter, r *http.Request) {
	var event models.StreamEvent
	if err := lib.DecodeJSON(r, &event); err != nil {
		lib.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	event.Path = lib.SanitizeString(event.Path)

	stream, err := h.service.StartStream(r.Context(), &event)
	if err != nil {
		lib.Error(w, http.StatusInternalServerError, "failed to start stream")
		return
	}

	lib.JSON(w, http.StatusOK, stream)
}

func (h *StreamHandler) End(w http.ResponseWriter, r *http.Request) {
	var event models.StreamEvent
	if err := lib.DecodeJSON(r, &event); err != nil {
		lib.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	event.Path = lib.SanitizeString(event.Path)

	if err := h.service.EndStream(r.Context(), &event); err != nil {
		lib.Error(w, http.StatusInternalServerError, "failed to end stream")
		return
	}

	lib.JSON(w, http.StatusOK, map[string]string{"status": "ended"})
}

func (h *StreamHandler) GetStream(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !lib.IsValidID(id) {
		lib.Error(w, http.StatusBadRequest, "invalid stream id")
		return
	}

	stream, err := h.service.GetStream(r.Context(), id)
	if err != nil {
		if errors.Is(err, models.ErrStreamNotFound) {
			lib.Error(w, http.StatusNotFound, "stream not found")
			return
		}
		lib.Error(w, http.StatusInternalServerError, "internal error")
		return
	}

	lib.JSON(w, http.StatusOK, stream)
}

func (h *StreamHandler) GetViewers(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !lib.IsValidID(id) {
		lib.Error(w, http.StatusBadRequest, "invalid stream id")
		return
	}

	count, err := h.service.GetViewerCount(r.Context(), id)
	if err != nil {
		if errors.Is(err, models.ErrStreamNotFound) {
			lib.Error(w, http.StatusNotFound, "stream not found")
			return
		}
		lib.Error(w, http.StatusInternalServerError, "internal error")
		return
	}

	lib.JSON(w, http.StatusOK, count)
}

func (h *StreamHandler) BanUser(w http.ResponseWriter, r *http.Request) {
	streamID := r.PathValue("id")
	userID := r.PathValue("userId")

	if !lib.IsValidID(streamID) || !lib.IsValidID(userID) {
		lib.Error(w, http.StatusBadRequest, "invalid stream or user id")
		return
	}

	if err := h.service.BanUser(r.Context(), streamID, userID); err != nil {
		if errors.Is(err, models.ErrStreamNotFound) {
			lib.Error(w, http.StatusNotFound, "stream not found")
			return
		}
		if errors.Is(err, models.ErrAlreadyBanned) {
			lib.Error(w, http.StatusConflict, "user already banned")
			return
		}
		lib.Error(w, http.StatusInternalServerError, "internal error")
		return
	}

	lib.JSON(w, http.StatusOK, map[string]string{"status": "banned"})
}
