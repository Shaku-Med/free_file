package captions

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/go-github/v62/github"

	captionslib "goupload/lib/captions"
	ghlib "goupload/lib/github"
	"goupload/lib/logger"
)

const (
	consumeTimeout = 12 * time.Second
	commitTimeout  = 12 * time.Second
	githubTimeout  = 30 * time.Second
)

type Config struct {
	GitHubClient *github.Client
	GitHubOwner  string
	AppBaseURL   string
	AppSecret    string
}

type Handler struct {
	log *logger.Logger
	cfg Config
}

func RegisterRoutes(app *fiber.App, log *logger.Logger, cfg Config) {
	cfg.AppBaseURL = strings.TrimSuffix(cfg.AppBaseURL, "/")
	h := &Handler{log: log, cfg: cfg}
	app.Post("/api/captions/upload", h.upload)
	app.Post("/api/captions/delete", h.delete)
}

type tokenPayload struct {
	UserID     string `json:"user_id"`
	FileID     string `json:"file_id"`
	UniqueID   string `json:"unique_id"`
	DateFolder string `json:"date_folder"`
	GithubRepo string `json:"github_repo"`
	Language   string `json:"language"`
	Action     string `json:"action"`
}

func (h *Handler) consumeToken(ctx context.Context, token, expectedAction string) (*tokenPayload, int, error) {
	if h.cfg.AppBaseURL == "" || h.cfg.AppSecret == "" {
		return nil, http.StatusInternalServerError, errors.New("app not configured")
	}
	url := h.cfg.AppBaseURL + "/api/internal/captions/consume-token"
	bodyJSON, _ := json.Marshal(map[string]string{"token": token, "expected_action": expectedAction})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyJSON))
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Secret", h.cfg.AppSecret)

	client := &http.Client{Timeout: consumeTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, http.StatusUnauthorized, errors.New("token not found")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, http.StatusUnauthorized, fmt.Errorf("token rejected (%d)", resp.StatusCode)
	}
	limited := io.LimitReader(resp.Body, 4096)
	var payload tokenPayload
	if err := json.NewDecoder(limited).Decode(&payload); err != nil {
		return nil, http.StatusInternalServerError, err
	}
	if payload.UserID == "" || payload.FileID == "" || payload.UniqueID == "" || payload.DateFolder == "" || payload.GithubRepo == "" || payload.Language == "" || payload.Action == "" {
		return nil, http.StatusInternalServerError, errors.New("invalid token payload")
	}
	if !captionslib.IsSafeUniqueID(payload.UniqueID) ||
		!captionslib.IsSafeDateFolder(payload.DateFolder) ||
		!captionslib.IsSafeGithubRepo(payload.GithubRepo) ||
		!captionslib.IsValidLanguageCode(payload.Language) {
		return nil, http.StatusInternalServerError, errors.New("invalid token fields")
	}
	return &payload, http.StatusOK, nil
}

func (h *Handler) postCommit(ctx context.Context, path string, payload map[string]string) error {
	if h.cfg.AppBaseURL == "" || h.cfg.AppSecret == "" {
		return errors.New("app not configured")
	}
	url := h.cfg.AppBaseURL + path
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Secret", h.cfg.AppSecret)

	client := &http.Client{Timeout: commitTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("commit failed (%d)", resp.StatusCode)
	}
	return nil
}

func (h *Handler) upload(c *fiber.Ctx) error {
	uid, _ := c.Locals("userID").(string)
	if uid == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing_user_id"})
	}

	if h.cfg.GitHubClient == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "storage not configured"})
	}

	token := strings.TrimSpace(c.FormValue("token"))
	if token == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "token is required"})
	}
	formLanguage := strings.TrimSpace(c.FormValue("language"))
	if !captionslib.IsValidLanguageCode(formLanguage) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid language"})
	}

	fileHeader, err := c.FormFile("file")
	if err != nil || fileHeader == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "file is required"})
	}
	if fileHeader.Size <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "empty file"})
	}
	if fileHeader.Size > captionslib.MaxVTTBytes {
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{
			"error": fmt.Sprintf("file exceeds %dKB limit", captionslib.MaxVTTBytes/1024),
		})
	}

	src, err := fileHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to read file"})
	}
	defer src.Close()
	limited := io.LimitReader(src, captionslib.MaxVTTBytes+1)
	raw, err := io.ReadAll(limited)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to read file"})
	}
	if int64(len(raw)) > captionslib.MaxVTTBytes {
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{"error": "file too large"})
	}

	cleaned, cueCount, err := captionslib.Sanitize(raw)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid VTT: " + err.Error()})
	}
	if cueCount == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "no usable cues"})
	}

	consumeCtx, consumeCancel := context.WithTimeout(c.Context(), consumeTimeout)
	defer consumeCancel()
	tk, status, err := h.consumeToken(consumeCtx, token, "upload")
	if err != nil {
		h.log.Errorf("caption token consume failed user=%s err=%v", uid, err)
		return c.Status(status).JSON(fiber.Map{"error": "token invalid"})
	}
	if tk.UserID != uid {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "token user mismatch"})
	}
	if tk.Language != formLanguage {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "language mismatch"})
	}

	ghPath := fmt.Sprintf("%s/%s/captions/%s.vtt", tk.DateFolder, tk.UniqueID, tk.Language)

	ghCtx, ghCancel := context.WithTimeout(context.Background(), githubTimeout)
	defer ghCancel()
	if err := ghlib.CreateOrUpdateFile(
		ghCtx,
		h.cfg.GitHubClient,
		h.cfg.GitHubOwner,
		tk.GithubRepo,
		ghPath,
		[]byte(cleaned),
		fmt.Sprintf("Caption %s for %s", tk.Language, tk.UniqueID),
	); err != nil {
		h.log.Errorf("caption github upload failed user=%s repo=%s path=%s err=%v", uid, tk.GithubRepo, ghPath, err)
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "storage upload failed"})
	}

	commitCtx, commitCancel := context.WithTimeout(context.Background(), commitTimeout)
	defer commitCancel()
	if err := h.postCommit(commitCtx, "/api/internal/captions/commit", map[string]string{
		"file_id":  tk.FileID,
		"user_id":  tk.UserID,
		"language": tk.Language,
		"path":     ghPath,
	}); err != nil {
		h.log.Errorf("caption commit failed user=%s file=%s err=%v", uid, tk.FileID, err)
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "commit failed"})
	}

	h.log.Infof("caption upload user=%s file=%s repo=%s lang=%s cues=%d size=%d", uid, tk.FileID, tk.GithubRepo, tk.Language, cueCount, len(cleaned))
	return c.JSON(fiber.Map{
		"success":  true,
		"language": tk.Language,
		"cues":     cueCount,
		"bytes":    len(cleaned),
	})
}

type deleteRequest struct {
	Token    string `json:"token"`
	Language string `json:"language"`
}

func (h *Handler) delete(c *fiber.Ctx) error {
	uid, _ := c.Locals("userID").(string)
	if uid == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing_user_id"})
	}
	if h.cfg.GitHubClient == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "storage not configured"})
	}

	var req deleteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}
	req.Token = strings.TrimSpace(req.Token)
	req.Language = strings.TrimSpace(req.Language)
	if req.Token == "" || !captionslib.IsValidLanguageCode(req.Language) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request"})
	}

	consumeCtx, consumeCancel := context.WithTimeout(c.Context(), consumeTimeout)
	defer consumeCancel()
	tk, status, err := h.consumeToken(consumeCtx, req.Token, "delete")
	if err != nil {
		return c.Status(status).JSON(fiber.Map{"error": "token invalid"})
	}
	if tk.UserID != uid {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "token user mismatch"})
	}
	if tk.Language != req.Language {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "language mismatch"})
	}

	ghPath := fmt.Sprintf("%s/%s/captions/%s.vtt", tk.DateFolder, tk.UniqueID, tk.Language)

	ghCtx, ghCancel := context.WithTimeout(context.Background(), githubTimeout)
	defer ghCancel()
	if err := deleteGitHubFile(ghCtx, h.cfg.GitHubClient, h.cfg.GitHubOwner, tk.GithubRepo, ghPath, fmt.Sprintf("Remove caption %s for %s", tk.Language, tk.UniqueID)); err != nil {
		h.log.Errorf("caption github delete failed user=%s repo=%s path=%s err=%v", uid, tk.GithubRepo, ghPath, err)
	}

	commitCtx, commitCancel := context.WithTimeout(context.Background(), commitTimeout)
	defer commitCancel()
	if err := h.postCommit(commitCtx, "/api/internal/captions/uncommit", map[string]string{
		"file_id":  tk.FileID,
		"user_id":  tk.UserID,
		"language": tk.Language,
	}); err != nil {
		h.log.Errorf("caption uncommit failed user=%s file=%s err=%v", uid, tk.FileID, err)
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "uncommit failed"})
	}

	h.log.Infof("caption delete user=%s file=%s repo=%s lang=%s", uid, tk.FileID, tk.GithubRepo, tk.Language)
	return c.JSON(fiber.Map{"success": true, "language": tk.Language})
}

func deleteGitHubFile(ctx context.Context, client *github.Client, owner, repo, path, message string) error {
	if client == nil {
		return errors.New("nil github client")
	}
	fc, _, _, err := client.Repositories.GetContents(ctx, owner, repo, path, nil)
	if err != nil {
		var ge *github.ErrorResponse
		if errors.As(err, &ge) && ge.Response != nil && ge.Response.StatusCode == 404 {
			return nil
		}
		return err
	}
	if fc == nil || fc.GetSHA() == "" {
		return nil
	}
	sha := fc.GetSHA()
	_, _, err = client.Repositories.DeleteFile(ctx, owner, repo, path, &github.RepositoryContentFileOptions{
		Message: &message,
		SHA:     &sha,
	})
	return err
}
