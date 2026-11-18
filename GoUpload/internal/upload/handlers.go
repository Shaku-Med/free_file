package upload

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
	"goupload/lib/logger"
	"goupload/lib/queue"
	"goupload/lib/quota"
	"goupload/lib/usercap"
	"goupload/lib/webhook"
)

type Handler struct {
	manager    *Manager
	queue      *queue.Client
	log        *logger.Logger
	caps       *usercap.Limiter
	newUploads []usercap.Window
}

// Options carries the per account cap on new uploads. Caps must be set in
// production; without it every new upload is refused.
type Options struct {
	Caps       *usercap.Limiter
	NewUploads []usercap.Window
}

func RegisterRoutes(app *fiber.App, manager *Manager, q *queue.Client, log *logger.Logger, opts Options) {
	handler := &Handler{manager: manager, queue: q, log: log, caps: opts.Caps, newUploads: opts.NewUploads}
	app.Post("/api/upload/start", handler.startUpload)
	app.Get("/api/upload/:upload_id/status", handler.getChunkStatus) // chunk progress for resume only
	app.Post("/api/upload/chunk", handler.uploadChunk)
	app.Post("/api/upload/:upload_id/complete", handler.completeUpload)
}

type uploadCapError struct{ wait time.Duration }

func (e uploadCapError) Error() string { return "upload_limit" }

var errCapUnavailable = errors.New("cap_unavailable")

func (h *Handler) startUpload(c *fiber.Ctx) error {
	userID := userIDFromCtx(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing_user_id"})
	}
	var req StartRequest
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, "invalid_body")
	}
	// A file bigger than what the user has left this month is turned away
	// before any of it is sent. /complete checks again and reserves the room.
	if req.FileSize > 0 && req.FileSize <= h.manager.maxFileBytes {
		qres, qerr := quota.Check(c.UserContext(), userID, req.FileSize)
		if qerr != nil {
			if h.log != nil {
				h.log.Errorf("quota_check_unavailable user=%s stage=start err=%s", userID, qerr.Error())
			}
			return quotaUnavailable(c)
		}
		if !qres.OK {
			return quotaRejected(c, qres, req.FileSize)
		}
	}
	// Each new upload ends in paid Vision checks, so an account gets a fixed
	// number per hour and per day however it scripts them.
	admit := func() error {
		ok, wait, err := h.caps.Take(c.UserContext(), userID, h.newUploads...)
		if err != nil {
			if h.log != nil {
				h.log.Errorf("upload_cap_unavailable user=%s err=%s", userID, err.Error())
			}
			return errCapUnavailable
		}
		if !ok {
			return uploadCapError{wait: wait}
		}
		return nil
	}
	resp, busy, err := h.manager.StartUpload(userID, req, admit)
	if busy != nil {
		return serverBusy(c, busy)
	}
	var capErr uploadCapError
	switch {
	case errors.As(err, &capErr):
		secs := int(capErr.wait.Round(time.Second) / time.Second)
		if secs < 1 {
			secs = 1
		}
		c.Set("Retry-After", strconv.Itoa(secs))
		return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{"error": "upload_limit", "retry_after": secs})
	case errors.Is(err, errCapUnavailable):
		return serverBusy(c, &BusyReason{Reason: "busy", RetryAfter: 30})
	case errors.Is(err, ErrFileTooLarge):
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{"error": "file_too_large"})
	case err != nil:
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
		if errors.Is(err, ErrDiskFull) {
			if h.log != nil {
				h.log.Errorf("chunk_refused_disk_low user=%s upload=%s", userID, uploadID)
			}
			return serverBusy(c, &BusyReason{Reason: "disk_full", RetryAfter: 60})
		}
		return h.safeErrorResponse(c, userID, uploadID, "chunk", err)
	}
	if h.log != nil {
		h.log.Infof("chunk_received user=%s upload=%s chunk=%d", userID, uploadID, index)
	}
	return c.JSON(resp)
}

type completeBody struct {
	IsPublic *bool `json:"is_public"`
	// Three state visibility from the uploader: "public", "unlisted" or
	// "private". Authoritative when present; is_public is only a fallback for
	// older clients that do not send this yet. Validated below, because it is
	// client input and lands in a Postgres enum.
	Visibility       string   `json:"visibility"`
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
	maxTags           = 15
	maxTagLen         = 50
	maxEpisodeNameLen = 500
	// The UI takes covers up to 10 MB, which is this much base64 plus a data
	// URL prefix.
	maxThumbnailB64 = 14_000_000
)

// uploadCategories is the category list the upload UI offers.
var uploadCategories = []string{
	"Gaming", "Music", "Entertainment", "Education", "Technology", "Sports", "News",
	"Lifestyle", "Anime", "Film", "Automotive", "Art", "Nature", "Other",
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func clampRunes(s string, max int) string {
	r := []rune(s)
	if len(r) > max {
		return string(r[:max])
	}
	return s
}

// cleanCategories keeps only names from the UI's list, once each.
func cleanCategories(in []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, raw := range in {
		for _, name := range uploadCategories {
			if strings.EqualFold(strings.TrimSpace(raw), name) && !seen[name] {
				seen[name] = true
				out = append(out, name)
			}
		}
	}
	return out
}

// cleanTags applies the UI's tag rules: trimmed, lower case, 50 characters at
// most, no repeats, 15 at most.
func cleanTags(in []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, raw := range in {
		if len(out) == maxTags {
			break
		}
		tag := strings.ToLower(strings.TrimSpace(raw))
		if tag == "" || utf8.RuneCountInString(tag) > maxTagLen || seen[tag] || strings.IndexFunc(tag, unicode.IsControl) >= 0 {
			continue
		}
		seen[tag] = true
		out = append(out, tag)
	}
	return out
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
	visibility := "" // empty means "not specified"; the app derives from isPublic
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
		// Allowlist, never passed through raw. An unrecognised value is dropped
		// rather than forwarded, so a malformed or hostile body cannot reach the
		// enum, and the app falls back to the boolean.
		switch b.Visibility {
		case "public", "unlisted", "private":
			visibility = b.Visibility
			isPublic = b.Visibility == "public"
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
		userCategories = cleanCategories(b.Categories)
		userTags = cleanTags(b.Tags)
		if len(b.DefaultThumbnail) > maxThumbnailB64 {
			return badRequest(c, "thumbnail_too_large")
		}
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
	newEpisodeName := clampRunes(strings.TrimSpace(seriesBody.NewEpisodeName), maxEpisodeNameLen)
	parentEpisodeID := strings.TrimSpace(seriesBody.ParentEpisodeID)
	if isNewSeries {
		fileSeriesID = ""
		fileSeriesEpisodeID = ""
		parentEpisodeID = ""
	} else if fileSeriesEpisodeID != "" {
		newEpisodeName = ""
		parentEpisodeID = ""
	}
	for _, id := range []string{fileSeriesID, fileSeriesEpisodeID, parentEpisodeID} {
		if id != "" && !uuidPattern.MatchString(id) {
			return badRequest(c, "invalid_series_id")
		}
	}

	meta, err := h.manager.BeginComplete(userID, uploadID)
	if errors.Is(err, ErrCompleteInProgress) {
		c.Set("Retry-After", "5")
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "complete_in_progress"})
	}
	if err != nil {
		return h.safeErrorResponse(c, userID, uploadID, "complete", err)
	}
	// Already queued by an earlier call: same answer, nothing processed twice.
	if meta.JobID != "" {
		return c.JSON(CompleteResponse{Status: "queued", JobID: meta.JobID})
	}
	queued := false
	admitted := false
	defer func() {
		if queued {
			return
		}
		h.manager.AbortComplete(uploadID)
		if admitted {
			if err := quota.Release(context.Background(), userID, uploadID); err != nil && h.log != nil {
				h.log.Errorf("quota_release_failed user=%s upload=%s err=%s", userID, uploadID, err.Error())
			}
		}
	}()

	// Measured on disk, not taken from the client.
	actualBytes, sizeErr := h.manager.ChunkFolderSize(userID, uploadID)
	if sizeErr != nil {
		if h.log != nil {
			h.log.Errorf("chunk_size_error user=%s upload=%s err=%s", userID, uploadID, sizeErr.Error())
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal_error"})
	}

	// The file goes in when it fits in what the user has left. Its stored size
	// after processing can be bigger; the app caps that charge at the room the
	// user had, so it can use up the rest of the month but never go past it.
	// An unanswered check never lets an upload through: the chunks stay on
	// disk and /complete can be retried.
	qres, qerr := quota.Admit(c.UserContext(), userID, uploadID, actualBytes)
	if qerr != nil {
		if h.log != nil {
			h.log.Errorf("quota_check_unavailable user=%s upload=%s err=%s", userID, uploadID, qerr.Error())
		}
		return quotaUnavailable(c)
	}
	if !qres.OK {
		_ = h.manager.AbandonUpload(userID, uploadID)
		if h.log != nil {
			h.log.Infof("quota_reject user=%s upload=%s bytes=%d used=%d limit=%d", userID, uploadID, actualBytes, qres.Used, qres.Limit)
		}
		return quotaRejected(c, qres, actualBytes)
	}
	admitted = true

	jobID, err := h.queue.Enqueue(context.Background(), meta.UserID, meta.UploadID, meta.FileName, meta.FileSize, meta.TotalChunks, title, description, userCategories, userTags, defaultThumbnail, reelMode, fileSeriesID, fileSeriesEpisodeID, isNewSeries, newEpisodeName, parentEpisodeID)
	if err != nil {
		if h.log != nil {
			h.log.Errorf("queue_error user=%s upload=%s err=%s", userID, uploadID, err.Error())
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "queue_failed"})
	}
	queued = true
	if err := h.manager.FinishComplete(userID, uploadID, jobID); err != nil && h.log != nil {
		h.log.Errorf("complete_mark_queued user=%s upload=%s job=%s err=%s", userID, uploadID, jobID, err.Error())
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
		Visibility:          visibility,
		CommentsEnabled:     &commentsEnabled,
		Title:               title,
		Description:         description,
		FileSeriesID:        fileSeriesID,
		FileSeriesEpisodeID: fileSeriesEpisodeID,
		IsNewSeries:         isNewSeries,
		NewEpisodeName:      newEpisodeName,
		ParentEpisodeID:     parentEpisodeID,
		StorageBackend:      "r2",
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
	"invalid_chunk_size":    true,
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

func quotaUnavailable(c *fiber.Ctx) error {
	c.Set("Retry-After", "30")
	return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "quota_unavailable"})
}

func quotaRejected(c *fiber.Ctx, q quota.CheckResult, fileBytes int64) error {
	return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{
		"error":        "monthly_limit_exceeded",
		"used":         q.Used,
		"limit":        q.Limit,
		"remaining":    q.Remaining,
		"source_bytes": fileBytes,
	})
}

func trimForLog(b []byte, max int) string {
	s := string(b)
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}
