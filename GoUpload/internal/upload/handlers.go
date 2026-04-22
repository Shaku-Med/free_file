package upload

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"goupload/lib/env"
	"goupload/lib/logger"
	"goupload/lib/queue"
	"goupload/lib/webhook"
)

type Handler struct {
	manager *Manager
	queue   *queue.Client
	log     *logger.Logger
}

func RegisterRoutes(app *fiber.App, manager *Manager, q *queue.Client, log *logger.Logger) {
	handler := &Handler{manager: manager, queue: q, log: log}
	app.Post("/api/upload/start", handler.startUpload)
	app.Get("/api/upload/:upload_id/status", handler.getChunkStatus) // chunk progress for resume only
	app.Post("/api/upload/chunk", handler.uploadChunk)
	app.Post("/api/upload/:upload_id/complete", handler.completeUpload)
}

func (h *Handler) startUpload(c *fiber.Ctx) error {
	userID := userIDFromCtx(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing_user_id"})
	}
	var req StartRequest
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, "invalid_body")
	}
	resp, busy, err := h.manager.StartUpload(userID, req)
	if busy != nil {
		return serverBusy(c, busy)
	}
	if err != nil {
		return h.safeErrorResponse(c, userID, "", "start", err)
	}
	return c.Status(fiber.StatusCreated).JSON(resp)
}

func (h *Handler) getChunkStatus(c *fiber.Ctx) error {
	userID := userIDFromCtx(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing_user_id"})
	}
	uploadID := c.Params("upload_id")
	if uploadID == "" {
		return badRequest(c, "missing_upload_id")
	}
	if !ValidUploadID(uploadID) {
		return badRequest(c, "invalid_upload_id")
	}
	status, err := h.manager.GetStatus(userID, uploadID)
	if err != nil {
		return notFound(c, "upload_not_found")
	}
	return c.JSON(status)
}

func (h *Handler) uploadChunk(c *fiber.Ctx) error {
	userID := userIDFromCtx(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing_user_id"})
	}
	uploadID := c.Get("X-Upload-ID")
	if uploadID == "" {
		return badRequest(c, "missing_upload_id")
	}
	if !ValidUploadID(uploadID) {
		return badRequest(c, "invalid_upload_id")
	}
	index, err := parseChunkIndex(c.Get("X-Chunk-Index"))
	if err != nil {
		return badRequest(c, "invalid_chunk_index")
	}
	body := c.Body()
	if len(body) == 0 {
		return badRequest(c, "empty_chunk")
	}
	resp, err := h.manager.SaveChunk(userID, uploadID, index, bytes.NewReader(body))
	if err != nil {
		if os.IsNotExist(err) {
			return notFound(c, "upload_not_found")
		}
		return h.safeErrorResponse(c, userID, uploadID, "chunk", err)
	}
	if h.log != nil {
		h.log.Infof("chunk_received user=%s upload=%s chunk=%d", userID, uploadID, index)
	}
	return c.JSON(resp)
}

type completeBody struct {
	IsPublic         *bool    `json:"is_public"`
	Title            string   `json:"title"`
	Description      string   `json:"description"`
	Categories       []string `json:"categories"`
	Tags             []string `json:"tags"`
	CommentsEnabled  *bool    `json:"comments_enabled"`
	DefaultThumbnail string   `json:"default_thumbnail"`
	FileSeriesID        string `json:"file_series_id"`
	FileSeriesEpisodeID string `json:"file_series_episode_id"`
	IsNewSeries         *bool  `json:"is_new_series"`
	NewEpisodeName      string `json:"new_episode_name"`
	ParentEpisodeID     string `json:"parent_episode_id"`
}

func validateFileSeriesComplete(b completeBody) error {
	isNew := b.IsNewSeries != nil && *b.IsNewSeries
	fsid := strings.TrimSpace(b.FileSeriesID)
	epid := strings.TrimSpace(b.FileSeriesEpisodeID)
	epName := strings.TrimSpace(b.NewEpisodeName)
	if !isNew && fsid == "" {
		return nil
	}
	if isNew {
		if epName == "" {
			return errors.New("series_episode_name_required")
		}
		return nil
	}
	if fsid == "" {
		return errors.New("series_id_required")
	}
	if epid == "" && epName == "" {
		return errors.New("series_episode_or_new_name_required")
	}
	return nil
}

func (h *Handler) completeUpload(c *fiber.Ctx) error {
	userID := userIDFromCtx(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing_user_id"})
	}
	uploadID := c.Params("upload_id")
	if uploadID == "" {
		return badRequest(c, "missing_upload_id")
	}
	if !ValidUploadID(uploadID) {
		return badRequest(c, "invalid_upload_id")
	}

	isPublic := true
	commentsEnabled := true
	title, description := "", ""
	defaultThumbnail := ""
	var userCategories, userTags []string
	var seriesBody completeBody
	raw := c.Body()
	if len(raw) > 0 {
		var b completeBody
		if err := json.Unmarshal(raw, &b); err != nil {
			if h.log != nil {
				h.log.Errorf("complete_upload json_unmarshal user=%s upload=%s err=%s body_prefix=%q", userID, uploadID, err.Error(), trimForLog(raw, 200))
			}
			return badRequest(c, "invalid_body")
		}
		seriesBody = b
		if b.IsPublic != nil {
			isPublic = *b.IsPublic
		}
		if b.CommentsEnabled != nil {
			commentsEnabled = *b.CommentsEnabled
		}
		if b.Title != "" {
			title = b.Title
		}
		if b.Description != "" {
			description = b.Description
		}
		userCategories = b.Categories
		userTags = b.Tags
		defaultThumbnail = b.DefaultThumbnail
	}

	if err := validateFileSeriesComplete(seriesBody); err != nil {
		return badRequest(c, err.Error())
	}

	isNewSeries := seriesBody.IsNewSeries != nil && *seriesBody.IsNewSeries
	fileSeriesID := strings.TrimSpace(seriesBody.FileSeriesID)
	fileSeriesEpisodeID := strings.TrimSpace(seriesBody.FileSeriesEpisodeID)
	newEpisodeName := strings.TrimSpace(seriesBody.NewEpisodeName)
	parentEpisodeID := strings.TrimSpace(seriesBody.ParentEpisodeID)
	if isNewSeries {
		fileSeriesID = ""
		fileSeriesEpisodeID = ""
		parentEpisodeID = ""
	} else if fileSeriesEpisodeID != "" {
		newEpisodeName = ""
		parentEpisodeID = ""
	}

	meta, err := h.manager.CompleteUpload(userID, uploadID)
	if err != nil {
		return h.safeErrorResponse(c, userID, uploadID, "complete", err)
	}
	jobID, err := h.queue.Enqueue(context.Background(), meta.UserID, meta.UploadID, meta.FileName, meta.FileSize, meta.TotalChunks, title, description, userCategories, userTags, defaultThumbnail, fileSeriesID, fileSeriesEpisodeID, isNewSeries, newEpisodeName, parentEpisodeID)
	if err != nil {
		if h.log != nil {
			h.log.Errorf("queue_error user=%s upload=%s err=%s", userID, uploadID, err.Error())
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "queue_failed"})
	}
	_ = h.queue.SetJobStatus(c.Context(), jobID, "queued")
	queuedPct := 0
	webhook.NotifyJobStatus(webhook.Payload{
		JobID:               jobID,
		Status:              "queued",
		UploadID:            meta.UploadID,
		UserID:              meta.UserID,
		FileName:            meta.FileName,
		FileSize:            meta.FileSize,
		Progress:            &queuedPct,
		IsPublic:            &isPublic,
		CommentsEnabled:     &commentsEnabled,
		Title:               title,
		Description:         description,
		FileSeriesID:        fileSeriesID,
		FileSeriesEpisodeID: fileSeriesEpisodeID,
		IsNewSeries:         isNewSeries,
		NewEpisodeName:      newEpisodeName,
		ParentEpisodeID:     parentEpisodeID,
		GitHubRepo:          strings.TrimSpace(env.Get("GITHUB_REPO", "")),
	})
	if h.log != nil {
		h.log.Infof("upload_queued user=%s upload=%s job=%s", userID, uploadID, jobID)
	}
	return c.JSON(CompleteResponse{Status: "queued", JobID: jobID})
}

func userIDFromCtx(c *fiber.Ctx) string {
	if v := c.Locals("userID"); v != nil {
		if s, ok := v.(string); ok && s != "" {
			return s
		}
	}
	return ""
}

func parseChunkIndex(value string) (int, error) {
	if value == "" {
		return 0, errors.New("missing_chunk_index")
	}
	index, err := strconv.Atoi(value)
	if err != nil || index < 0 {
		return 0, errors.New("invalid_chunk_index")
	}
	return index, nil
}

// safeErrorCodes enumerates stable error strings returned by the manager that are safe
// to pass to clients. Anything else (e.g. raw os.PathError) is replaced with
// "internal_error" to avoid leaking filesystem paths or user identifiers.
var safeErrorCodes = map[string]bool{
	"invalid_request":       true,
	"invalid_file_name":     true,
	"invalid_upload_id":     true,
	"invalid_chunk_index":   true,
	"invalid_chunks":        true,
	"unsupported_file_type": true,
	"missing_chunks":        true,
}

func (h *Handler) safeErrorResponse(c *fiber.Ctx, userID, uploadID, op string, err error) error {
	if err == nil {
		return nil
	}
	if os.IsNotExist(err) {
		return notFound(c, "upload_not_found")
	}
	code := err.Error()
	if safeErrorCodes[code] {
		return badRequest(c, code)
	}
	if h.log != nil {
		h.log.Errorf("upload_%s_error user=%s upload=%s err=%s", op, userID, uploadID, err.Error())
	}
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal_error"})
}

func badRequest(c *fiber.Ctx, code string) error {
	return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": code})
}

func notFound(c *fiber.Ctx, code string) error {
	return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": code})
}

func serverBusy(c *fiber.Ctx, reason *BusyReason) error {
	if reason.RetryAfter > 0 {
		c.Set("Retry-After", strconv.Itoa(reason.RetryAfter))
	}
	return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
		"error":       "server_busy",
		"retry_after": reason.RetryAfter,
		"reason":      reason.Reason,
	})
}

func trimForLog(b []byte, max int) string {
	s := string(b)
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}
