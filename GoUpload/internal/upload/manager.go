package upload

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

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

var allowedExtensions = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true, ".bmp": true,
	".mp4": true, ".webm": true, ".mkv": true, ".avi": true, ".mov": true, ".wmv": true, ".flv": true, ".m4v": true,
}

func isAllowedExtension(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	return allowedExtensions[ext]
}
