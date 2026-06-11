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
	"goupload/lib/ffmpeg"
	"goupload/lib/logger"
	"goupload/lib/queue"
	"goupload/lib/quota"
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
	// ReelMode: "auto" (default), "yes", or "no". Locked at upload time.
	ReelMode            string `json:"reel_mode"`
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

// Mirror the upload UI's input limits  the client enforces them with
// maxLength, but a crafted request can skip the form entirely.
const (
	maxTitleLen       = 200
	maxDescriptionLen = 1000
)

func clampRunes(s string, max int) string {
	r := []rune(s)
	if len(r) > max {
		return string(r[:max])
	}
	return s
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
			title = clampRunes(strings.TrimSpace(b.Title), maxTitleLen)
		}
		if b.Description != "" {
			description = clampRunes(strings.TrimSpace(b.Description), maxDescriptionLen)
		}
		userCategories = b.Categories
		userTags = b.Tags
		defaultThumbnail = b.DefaultThumbnail
	}

	reelMode := strings.TrimSpace(seriesBody.ReelMode)
	switch reelMode {
	case "", "auto", "yes", "no":
		// ok
	default:
		// Unknown value  quietly snap to auto rather than reject the upload.
		reelMode = "auto"
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

	// Weekly-quota gate. Measure ACTUAL on-disk bytes (we don't trust the
	// client-declared size), predict the post-processing footprint, and ask
	// the app whether it fits in the user's remaining budget. Reject + clean
	// up before we waste a worker slot on a job that would be over-limit.
	actualBytes, sizeErr := h.manager.ChunkFolderSize(userID, uploadID)
	if sizeErr != nil {
		if h.log != nil {
			h.log.Errorf("chunk_size_error user=%s upload=%s err=%s", userID, uploadID, sizeErr.Error())
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal_error"})
	}
	// Probe the first chunk for source resolution so the predictor can pick
	// the right HLS multiplier. ffprobe reads as much metadata as it can from
	// whatever bytes we point it at  for moov-at-start mp4 (the common case
	// for modern phones and web encoders) the first chunk is plenty. If the
	// probe fails (moov-at-end mobile files, broken first chunk, image, etc.)
	// we pass height=0 and PredictFinalBytes uses its worst-case fallback,
	// which over-estimates rather than under-estimates  the only failure
	// mode is "quota-reject an upload that would have actually fit", never
	// "let an over-budget upload through". The latter would let users do the
	// "10 GB file with 2 GB left" abuse the user explicitly called out.
	srcHeight := 0
	if isLikelyVideo(meta.FileName) {
		if firstChunk := h.manager.FirstChunkPath(userID, uploadID); firstChunk != "" {
			if info, perr := ffmpeg.ProbeVideo(firstChunk); perr == nil && info != nil {
				srcHeight = info.Height
			}
		}
	}

	predicted := quota.PredictFinalBytes(actualBytes, meta.FileName, srcHeight)
	qres, qerr := quota.Check(c.Context(), userID, predicted)

	// Monthly budget full but the extra weekly allowance still fits: accept
	// the upload and let the worker route it to the overflow backend. The
	// client never learns where it landed — same response as a normal accept.
	// Requires the GitHub backend to be configured (worker can't honor the
	// overflow flag without it).
	overflowUpload := false
	if qerr == nil && !qres.OK && qres.OverflowOK && overflowBackendConfigured() {
		overflowUpload = true
		if h.log != nil {
			h.log.Infof("quota_overflow_route user=%s upload=%s predicted=%d overflow_used=%d overflow_limit=%d",
				userID, uploadID, predicted, qres.OverflowUsed, qres.OverflowLimit)
		}
	}

	if qerr == nil && !qres.OK && !overflowUpload {
		// 1. Delete THIS upload's chunks (the one that just tripped the cap).
		_ = h.manager.AbandonUpload(userID, uploadID)

		// 2. Sweep every other chunk folder this user has on disk. A user
		//    that's over the weekly cap can't make ANY of their pending
		//    uploads succeed  every future /complete will fail the same
		//    quota check, so we'd be holding storage for nothing. Anything
		//    already accepted into the worker queue is untouched (the
		//    worker will finish it; that's a sunk cost we don't undo).
		purgedIDs, purgeErr := h.manager.PurgeUserChunks(userID, "")
		if purgeErr != nil && h.log != nil {
			h.log.Errorf("purge_user_chunks_error user=%s err=%s", userID, purgeErr.Error())
		}

		// 3. Tell the app to drop the user's still-`queued` DB rows + refund
		//    their quota reservations. Best-effort  if the app is down the
		//    next /complete from this user will re-trigger this whole path.
		//    Runs in a goroutine so we don't block the 413 response on it;
		//    PurgeUser is panic-safe so this is fine even if the goroutine
		//    fails mid-call.
		go quota.PurgeUser(context.Background(), userID, purgedIDs)

		if h.log != nil {
			h.log.Infof("quota_reject user=%s upload=%s actual=%d predicted=%d src_height=%d used=%d limit=%d purged=%d",
				userID, uploadID, actualBytes, predicted, srcHeight, qres.Used, qres.Limit, len(purgedIDs))
		}
		// 413 Payload Too Large + machine-readable code so the client can
		// show a friendly "monthly limit reached" message (not a generic fail).
		// The `predicted` field tells the user this was a prediction-based
		// rejection (file would balloon past their cap after HLS ladder
		// expansion), not just "you already used it all"  the UI uses this
		// to render a "your file is predicted to exceed your limit after
		// processing" explanation instead of a generic over-quota message.
		// overflow_* lets the UI explain that the extra weekly allowance is
		// ALSO used up (it never names the backing storage).
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{
			"error":     "monthly_limit_exceeded",
			"used":      qres.Used,
			"limit":     qres.Limit,
			"remaining": qres.Remaining,
			"predicted": predicted,
			"source_bytes": actualBytes,
			"overflow_used":      qres.OverflowUsed,
			"overflow_limit":     qres.OverflowLimit,
			"overflow_remaining": qres.OverflowRemaining,
		})
	}

	jobID, err := h.queue.Enqueue(context.Background(), meta.UserID, meta.UploadID, meta.FileName, meta.FileSize, meta.TotalChunks, title, description, userCategories, userTags, defaultThumbnail, reelMode, fileSeriesID, fileSeriesEpisodeID, isNewSeries, newEpisodeName, parentEpisodeID, overflowUpload)
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
		Overflow:            overflowUpload,
	})
	if h.log != nil {
		h.log.Infof("upload_queued user=%s upload=%s job=%s", userID, uploadID, jobID)
	}
	return c.JSON(CompleteResponse{Status: "queued", JobID: jobID})
}

// overflowBackendConfigured reports whether the GitHub backend is usable for
// overflow uploads. Mirrors the main.go gate that builds the GitHub client.
func overflowBackendConfigured() bool {
	return env.Get("GITHUB_TOKEN", "") != "" &&
		env.Get("GITHUB_OWNER", "") != "" &&
		strings.TrimSpace(env.Get("GITHUB_REPO", "")) != ""
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

// isLikelyVideo reports whether a filename extension matches our accepted
// video formats. Used to skip the chunk-probe step on image uploads (probing
// a JPEG with ffprobe just returns 'no video stream', which is wasted work).
// The same allowlist lives in manager.allowedExtensions / quota.videoExt;
// we intentionally duplicate it here as a small constant rather than import
// because both other lists also contain image extensions, and a typo in one
// place wouldn't open a security hole  worst case we run an extra probe.
func isLikelyVideo(filename string) bool {
	ext := strings.ToLower(filename)
	for _, v := range []string{".mp4", ".webm", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".m4v"} {
		if strings.HasSuffix(ext, v) {
			return true
		}
	}
	return false
}
