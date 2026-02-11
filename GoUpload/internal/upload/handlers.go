package upload

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"strconv"

	"goupload/lib/logger"
	"goupload/lib/queue"
	"goupload/lib/webhook"
	"github.com/gofiber/fiber/v2"
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
		return badRequest(c, err.Error())
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
		return badRequest(c, err.Error())
	}
	if h.log != nil {
		h.log.Infof("chunk_received user=%s upload=%s chunk=%d", userID, uploadID, index)
	}
	return c.JSON(resp)
}

type completeBody struct {
	IsPublic    *bool    `json:"is_public"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Categories  []string `json:"categories"`
	Tags        []string `json:"tags"`
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

	isPublic := true
	title, description := "", ""
	var userCategories, userTags []string
	if len(c.Body()) > 0 {
		var b completeBody
		if err := json.Unmarshal(c.Body(), &b); err == nil {
			if b.IsPublic != nil {
				isPublic = *b.IsPublic
			}
			if b.Title != "" {
				title = b.Title
			}
			if b.Description != "" {
				description = b.Description
			}
			userCategories = b.Categories
			userTags = b.Tags
		}
	}

	meta, err := h.manager.CompleteUpload(userID, uploadID)
	if err != nil {
		return badRequest(c, err.Error())
	}
	jobID, err := h.queue.Enqueue(context.Background(), meta.UserID, meta.UploadID, meta.FileName, meta.FileSize, meta.TotalChunks, title, description, userCategories, userTags)
	if err != nil {
		if h.log != nil {
			h.log.Errorf("queue_error user=%s upload=%s err=%s", userID, uploadID, err.Error())
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "queue_failed"})
	}
	_ = h.queue.SetJobStatus(c.Context(), jobID, "queued")
	webhook.NotifyJobStatus(webhook.Payload{
		JobID:       jobID,
		Status:      "queued",
		UploadID:    meta.UploadID,
		UserID:      meta.UserID,
		FileName:    meta.FileName,
		FileSize:    meta.FileSize,
		IsPublic:    &isPublic,
		Title:       title,
		Description: description,
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


