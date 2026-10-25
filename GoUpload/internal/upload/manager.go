package upload

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"goupload/lib/security"
)

// uploadIDPattern matches IDs produced by newID() (32 lowercase hex chars).
var uploadIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

// ErrInvalidUploadID is returned when a client-supplied upload_id does not match the
// expected format. Must be checked before any filesystem path is built from it.
var ErrInvalidUploadID = errors.New("invalid_upload_id")

// ErrNotMedia is returned when the first chunk doesn't start like an image or
// video of the kind its extension claims, whatever it is instead.
var ErrNotMedia = errors.New("unsupported_file_type")

// ValidUploadID reports whether id is a well-formed upload identifier. Rejecting anything
// else prevents path traversal (e.g. "../victim/abcd") when the id is joined into a path.
func ValidUploadID(id string) bool {
	return uploadIDPattern.MatchString(id)
}

type Manager struct {
	baseDir       string
	maxDiskBytes  int64
	maxConcurrent int
	chunkSize     int64
	activeMu      sync.RWMutex
	active        map[string]UploadInfo
}

func NewManager(cfg ManagerConfig) *Manager {
	base := cfg.BaseDir
	if base == "" {
		base = "upload/temp"
	}
	maxDisk := cfg.MaxDiskBytes
	if maxDisk <= 0 {
		maxDisk = 40 << 30
	}
	maxConc := cfg.MaxConcurrent
	if maxConc <= 0 {
		maxConc = 10
	}
	size := cfg.ChunkSize
	if size <= 0 {
		size = ChunkSizeBytes
	}
	return &Manager{
		baseDir:       base,
		maxDiskBytes:  maxDisk,
		maxConcurrent: maxConc,
		chunkSize:     size,
		active:        make(map[string]UploadInfo),
	}
}

func (m *Manager) StartUpload(userID string, req StartRequest) (StartResponse, *BusyReason, error) {
	if userID == "" || req.FileName == "" || req.FileSize <= 0 || req.TotalChunks <= 0 {
		return StartResponse{}, nil, errors.New("invalid_request")
	}
	safeName, err := security.SafeUploadFilename(req.FileName)
	if err != nil {
		return StartResponse{}, nil, errors.New("invalid_file_name")
	}
	req.FileName = safeName
	if !isAllowedExtension(req.FileName) {
		return StartResponse{}, nil, errors.New("unsupported_file_type")
	}
	if req.TotalChunks > 0 && int64(req.TotalChunks)*m.chunkSize < req.FileSize {
		return StartResponse{}, nil, errors.New("invalid_chunks")
	}
	if meta, err := findExistingMeta(m.baseDir, userID, req.FileName, req.FileSize); err == nil {
		m.trackActive(meta)
		return StartResponse{UploadID: meta.UploadID, ChunkSize: meta.ChunkSize}, nil, nil
	}
	if reason := m.checkBusy(userID, req.FileSize); reason != nil {
		return StartResponse{}, reason, nil
	}

	uploadID := newID()
	if err := m.ensureDir(userID, uploadID); err != nil {
		return StartResponse{}, nil, err
	}
	meta := UploadMeta{
		UploadID:       uploadID,
		UserID:         userID,
		FileName:       req.FileName,
		FileSize:       req.FileSize,
		TotalChunks:    req.TotalChunks,
		ChunkSize:      m.chunkSize,
		ReceivedChunks: []int{},
		CreatedAt:      time.Now().UTC(),
		LastActivity:   time.Now().UTC(),
	}
	if err := writeMeta(metaPath(m.baseDir, userID, uploadID), meta); err != nil {
		return StartResponse{}, nil, err
	}
	m.trackActive(meta)
	return StartResponse{UploadID: uploadID, ChunkSize: m.chunkSize}, nil, nil
}

func (m *Manager) GetStatus(userID, uploadID string) (StatusResponse, error) {
	if !ValidUploadID(uploadID) {
		return StatusResponse{}, ErrInvalidUploadID
	}
	meta, err := readMeta(metaPath(m.baseDir, userID, uploadID))
	if err != nil {
		return StatusResponse{}, err
	}
	return StatusResponse{
		UploadID:       meta.UploadID,
		ReceivedChunks: normalizeChunks(meta.ReceivedChunks),
		TotalChunks:    meta.TotalChunks,
		CanResume:      len(meta.ReceivedChunks) < meta.TotalChunks,
	}, nil
}

func (m *Manager) SaveChunk(userID, uploadID string, chunkIndex int, body io.Reader) (ChunkResponse, error) {
	if !ValidUploadID(uploadID) {
		return ChunkResponse{}, ErrInvalidUploadID
	}
	meta, err := readMeta(metaPath(m.baseDir, userID, uploadID))
	if err != nil {
		return ChunkResponse{}, err
	}
	if chunkIndex < 0 || chunkIndex >= meta.TotalChunks {
		return ChunkResponse{}, errors.New("invalid_chunk_index")
	}
	for _, idx := range meta.ReceivedChunks {
		if idx == chunkIndex {
			return chunkStats(meta, chunkIndex), nil
		}
	}

	// The extension alone proves nothing, and /complete hands this chunk to
	// ffprobe, so the bytes must already be a real image or video by then.
	if chunkIndex == 0 {
		head := make([]byte, security.MediaHeaderLen)
		n, err := io.ReadFull(body, head)
		if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
			return ChunkResponse{}, err
		}
		if security.MediaKind(head[:n]) != extensionKind(meta.FileName) {
			return ChunkResponse{}, ErrNotMedia
		}
		body = io.MultiReader(bytes.NewReader(head[:n]), body)
	}

	path := chunkPath(m.baseDir, userID, uploadID, chunkIndex)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0600)
	if err != nil {
		return ChunkResponse{}, err
	}
	if _, err := io.Copy(file, body); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return ChunkResponse{}, err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(path)
		return ChunkResponse{}, err
	}

	meta.ReceivedChunks = append(meta.ReceivedChunks, chunkIndex)
	meta.LastActivity = time.Now().UTC()
	if err := writeMeta(metaPath(m.baseDir, userID, uploadID), meta); err != nil {
		return ChunkResponse{}, err
	}
	m.updateActivity(meta)
	return chunkStats(meta, chunkIndex), nil
}

func (m *Manager) CompleteUpload(userID, uploadID string) (CompleteMeta, error) {
	if !ValidUploadID(uploadID) {
		return CompleteMeta{}, ErrInvalidUploadID
	}
	meta, err := readMeta(metaPath(m.baseDir, userID, uploadID))
	if err != nil {
		return CompleteMeta{}, err
	}
	if len(normalizeChunks(meta.ReceivedChunks)) != meta.TotalChunks {
		return CompleteMeta{}, errors.New("missing_chunks")
	}
	m.clearActive(uploadID)
	return CompleteMeta{
		UserID:      userID,
		UploadID:    uploadID,
		FileName:    meta.FileName,
		FileSize:    meta.FileSize,
		TotalChunks: meta.TotalChunks,
	}, nil
}

// FirstChunkPath returns the on-disk path of the very first chunk for an
// upload. The handler uses this to ffprobe for source resolution at /complete
// time so PredictFinalBytes can pick the correct HLS multiplier instead of
// the worst-case fallback. Returns "" when the upload id is malformed; the
// caller treats that as "no probe possible" and uses the conservative path.
func (m *Manager) FirstChunkPath(userID, uploadID string) string {
	if !ValidUploadID(uploadID) {
		return ""
	}
	return chunkPath(m.baseDir, userID, uploadID, 0)
}

// ChunkFolderSize returns the actual on-disk byte sum of every chunk for an
// upload. Used to size-check before queueing without trusting the client-
// declared FileSize.
func (m *Manager) ChunkFolderSize(userID, uploadID string) (int64, error) {
	if !ValidUploadID(uploadID) {
		return 0, ErrInvalidUploadID
	}
	dir := filepath.Join(m.baseDir, userID, uploadID)
	var size int64
	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		// Skip metadata file; only count actual chunks.
		if d.Name() == "meta.json" {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		size += info.Size()
		return nil
	})
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return 0, nil
		}
		return 0, err
	}
	return size, nil
}

// AbandonUpload deletes every chunk + meta for an upload and forgets it. Use
// when a quota check rejects an upload after chunks were already stored.
func (m *Manager) AbandonUpload(userID, uploadID string) error {
	if !ValidUploadID(uploadID) {
		return ErrInvalidUploadID
	}
	m.clearActive(uploadID)
	dir := filepath.Join(m.baseDir, userID, uploadID)
	return os.RemoveAll(dir)
}

// userIDSafe is the same shape the auth middleware accepts (UUID-ish, max 64
// chars, no path separators). Re-applied here so any future caller that
// bypasses the middleware can't pass `../victim` into a filesystem op.
var userIDSafe = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

// PurgeUserChunks removes EVERY abandoned chunk folder for a user under the
// chunks root. Used when the user hits their weekly quota cap: the upload
// they just tried to finish is already gone via AbandonUpload, and any other
// chunk folder for the same user is now over-budget too  we'd just be
// holding storage for files that will all get rejected at /complete anyway.
//
// `keep` is an optional uploadID to spare (e.g. the rejected upload that we
// want to log separately, or an upload we know is currently mid-chunk-write).
// Pass "" to purge everything.
//
// Returns the list of uploadIDs that were actually removed so the caller can
// tell the app to refund their quota reservations + delete their DB rows.
//
// Defence in depth: userID is re-validated against `userIDSafe` to prevent
// path traversal even if the caller forgot to do so; we never walk outside
// `m.baseDir/<validated userID>`.
func (m *Manager) PurgeUserChunks(userID, keep string) ([]string, error) {
	if !userIDSafe.MatchString(userID) {
		return nil, errors.New("invalid_user_id")
	}

	// Snapshot + clear in-memory entries first so a concurrent SaveChunk on a
	// purged upload sees the cleared state and bails. We hold the write lock
	// only briefly  the disk delete loop below doesn't need it.
	m.activeMu.Lock()
	removed := make(map[string]struct{})
	for id, info := range m.active {
		if info.UserID != userID || id == keep {
			continue
		}
		if !ValidUploadID(id) {
			// Skip anything that looks malformed; we never want to act on it
			// even from in-memory state.
			continue
		}
		removed[id] = struct{}{}
		delete(m.active, id)
	}
	m.activeMu.Unlock()

	// Walk the user's chunks dir and delete every upload subdir. This catches
	// crash-debris (chunks left over from a previous process that wasn't in
	// our in-memory `active` map) on top of the live entries we cleared above.
	userDir := filepath.Join(m.baseDir, userID)
	entries, readErr := os.ReadDir(userDir)
	if readErr != nil {
		if errors.Is(readErr, os.ErrNotExist) {
			// No on-disk debris; just return whatever we cleared from memory.
			return setToSortedSlice(removed), nil
		}
		// Even if reading the dir failed we already cleared memory; surface
		// the error so the caller can log it.
		return setToSortedSlice(removed), readErr
	}

	// Defensive cap. A user dir should hold at most a handful of upload
	// folders; if there are millions, something is very wrong and walking
	// them all would just stall the request. Cap at 1000 deletions per call;
	// any leftover gets cleaned by the background CleanupOrphanedChunks loop.
	const maxPurgePerCall = 1000
	deleted := 0
	for _, entry := range entries {
		if deleted >= maxPurgePerCall {
			break
		}
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		if name == keep {
			continue
		}
		// Only act on directories that match the upload-id shape. Anything
		// else might be unrelated content we shouldn't touch.
		if !ValidUploadID(name) {
			continue
		}
		removed[name] = struct{}{}
		// os.RemoveAll is no-op if the dir vanished between ReadDir and now.
		_ = os.RemoveAll(filepath.Join(userDir, name))
		deleted++
	}
	return setToSortedSlice(removed), nil
}

func setToSortedSlice(s map[string]struct{}) []string {
	if len(s) == 0 {
		return nil
	}
	out := make([]string, 0, len(s))
	for k := range s {
		out = append(out, k)
	}
	// Stable order so callers / logs are deterministic. Sort uses the same
	// `sort` package already imported by meta.go.
	stringsSort(out)
	return out
}

// stringsSort sorts in-place. Kept as a thin wrapper so we don't add a fresh
// `sort` import just for one line; the package is already imported elsewhere
// in the upload package via meta.go.
func stringsSort(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j-1] > s[j]; j-- {
			s[j-1], s[j] = s[j], s[j-1]
		}
	}
}

func (m *Manager) ServerStatus() (ServerStatusResponse, error) {
	usage, err := m.diskUsage()
	if err != nil {
		return ServerStatusResponse{}, err
	}
	active := m.activeCount()
	accepting := usage < m.maxDiskBytes && active < m.maxConcurrent
	return ServerStatusResponse{
		AcceptingUploads: accepting,
		ActiveUploads:    active,
		DiskUsageGB:      bytesToGB(usage),
		DiskLimitGB:      bytesToGB(m.maxDiskBytes),
	}, nil
}

func (m *Manager) checkBusy(userID string, fileSize int64) *BusyReason {
	usage, err := m.diskUsage()
	if err == nil {
		if usage >= m.maxDiskBytes {
			return &BusyReason{Reason: "disk_full", RetryAfter: 60}
		}
		projected := usage + fileSize*2
		if projected >= m.maxDiskBytes {
			return &BusyReason{Reason: "disk_limit", RetryAfter: 60}
		}
	}
	if m.activeCount() >= m.maxConcurrent {
		return &BusyReason{Reason: "too_many_uploads", RetryAfter: 60}
	}
	if m.userHasActive(userID) {
		return &BusyReason{Reason: "user_active_upload", RetryAfter: 60}
	}
	return nil
}

func (m *Manager) ensureDir(userID, uploadID string) error {
	return os.MkdirAll(filepath.Join(m.baseDir, userID, uploadID), 0700)
}

func (m *Manager) trackActive(meta UploadMeta) {
	m.activeMu.Lock()
	m.active[meta.UploadID] = UploadInfo{
		UserID:              meta.UserID,
		UploadID:            meta.UploadID,
		FileName:            meta.FileName,
		FileSize:            meta.FileSize,
		TotalChunks:         meta.TotalChunks,
		StartedAt:           meta.CreatedAt,
		LastChunkReceivedAt: meta.LastActivity,
	}
	m.activeMu.Unlock()
}

func (m *Manager) updateActivity(meta UploadMeta) {
	m.activeMu.Lock()
	info, ok := m.active[meta.UploadID]
	if ok {
		info.LastChunkReceivedAt = meta.LastActivity
		m.active[meta.UploadID] = info
	}
	m.activeMu.Unlock()
}

func (m *Manager) clearActive(uploadID string) {
	m.activeMu.Lock()
	delete(m.active, uploadID)
	m.activeMu.Unlock()
}

func (m *Manager) userHasActive(userID string) bool {
	m.activeMu.RLock()
	defer m.activeMu.RUnlock()
	for _, info := range m.active {
		if info.UserID == userID {
			return true
		}
	}
	return false
}

func (m *Manager) activeCount() int {
	m.activeMu.RLock()
	defer m.activeMu.RUnlock()
	return len(m.active)
}

func (m *Manager) diskUsage() (int64, error) {
	var size int64
	err := filepath.WalkDir(m.baseDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		size += info.Size()
		return nil
	})
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return 0, nil
		}
		return 0, err
	}
	return size, nil
}

func chunkStats(meta UploadMeta, chunkIndex int) ChunkResponse {
	received := len(normalizeChunks(meta.ReceivedChunks))
	remaining := meta.TotalChunks - received
	return ChunkResponse{
		Received:      chunkIndex,
		TotalReceived: received,
		Remaining:     remaining,
	}
}

func bytesToGB(value int64) float64 {
	return float64(value) / (1024 * 1024 * 1024)
}

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format("20060102150405.000000000")))
	}
	return hex.EncodeToString(b)
}

var extensionKinds = map[string]string{
	".jpg": "image", ".jpeg": "image", ".png": "image", ".gif": "image", ".webp": "image", ".bmp": "image",
	".mp4": "video", ".webm": "video", ".mkv": "video", ".avi": "video", ".mov": "video", ".wmv": "video", ".flv": "video", ".m4v": "video",
}

// extensionKind is "image" or "video" for an accepted extension, "" otherwise.
func extensionKind(filename string) string {
	return extensionKinds[strings.ToLower(filepath.Ext(filename))]
}

func isAllowedExtension(filename string) bool {
	return extensionKind(filename) != ""
}
