package upload

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"hash/fnv"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"goupload/lib/security"
)

// activeIdleLimit is how long an upload can go without a chunk before it stops
// counting as active. Nothing tells the server when a browser closes or a
// connection dies, so silence is the only sign. A chunk is at most 25 MB, which
// clears this at about 1.7 Mbps; anything slower only lets go of its slot until
// its next chunk lands, and the chunks on disk are left alone either way.
const activeIdleLimit = 2 * time.Minute

// uploadIDPattern matches IDs produced by newID() (32 lowercase hex chars).
var uploadIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

// ErrInvalidUploadID is returned when a client-supplied upload_id does not match the
// expected format. Must be checked before any filesystem path is built from it.
var ErrInvalidUploadID = errors.New("invalid_upload_id")

// ErrNotMedia is returned when the first chunk doesn't start like an image or
// video of the kind its extension claims, whatever it is instead.
var ErrNotMedia = errors.New("unsupported_file_type")

var (
	ErrFileTooLarge = errors.New("file_too_large")
	// ErrChunkSize means a chunk is not exactly the size its index must be. Every
	// chunk is chunk_size bytes except the last, which holds the remainder, so a
	// declared file size is also the most an upload can ever put on disk.
	ErrChunkSize = errors.New("invalid_chunk_size")
	// ErrDiskFull is returned instead of writing a chunk that would leave the
	// disk under its free space floor.
	ErrDiskFull = errors.New("disk_full")
	// ErrCompleteInProgress is a second /complete arriving while the first is
	// still deciding whether to queue the upload.
	ErrCompleteInProgress = errors.New("complete_in_progress")

	errNoStatfs = errors.New("free space unknown on this platform")
)

// reclaimIdleAfter is how long an unfinished upload can sit untouched before
// its space may go to someone else when the disk is short. It stays resumable
// until then; after, its owner has to start that file over.
const reclaimIdleAfter = time.Hour

const defaultMinFreeBytes int64 = 2 << 30

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
	maxFileBytes  int64
	minFreeBytes  int64
	freeSpace     func(string) (int64, error)
	activeMu      sync.RWMutex
	active        map[string]UploadInfo
	// completing holds uploads a /complete is busy queueing.
	completing map[string]struct{}
	// startMu runs starts one at a time, so two cannot both pass the busy checks
	// or reclaim the same space.
	startMu sync.Mutex
	// One lock per upload, striped so the set stays bounded. Chunk writes,
	// completes and evictions of the same upload never interleave.
	uploadLocks [64]sync.Mutex
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
	maxFile := cfg.MaxFileBytes
	if maxFile <= 0 {
		maxFile = MaxFileBytesDefault
	}
	minFree := cfg.MinFreeBytes
	if minFree <= 0 {
		minFree = defaultMinFreeBytes
	}
	return &Manager{
		baseDir:       base,
		maxDiskBytes:  maxDisk,
		maxConcurrent: maxConc,
		chunkSize:     size,
		maxFileBytes:  maxFile,
		minFreeBytes:  minFree,
		freeSpace:     freeBytes,
		active:        make(map[string]UploadInfo),
		completing:    make(map[string]struct{}),
	}
}

func (m *Manager) lockUpload(uploadID string) func() {
	h := fnv.New32a()
	_, _ = h.Write([]byte(uploadID))
	mu := &m.uploadLocks[h.Sum32()%uint32(len(m.uploadLocks))]
	mu.Lock()
	return mu.Unlock
}

// expectedChunkLen is the exact byte count chunk index of an upload must hold.
func expectedChunkLen(meta UploadMeta, index int) (int64, bool) {
	if meta.ChunkSize <= 0 || meta.FileSize <= 0 || index < 0 || index >= meta.TotalChunks {
		return 0, false
	}
	if index < meta.TotalChunks-1 {
		return meta.ChunkSize, true
	}
	last := meta.FileSize - int64(meta.TotalChunks-1)*meta.ChunkSize
	if last <= 0 || last > meta.ChunkSize {
		return 0, false
	}
	return last, true
}

// StartUpload opens a new upload or resumes the caller's matching one. admit
// runs only for a brand new upload, after every other check passes; an error
// from it is returned as is and nothing is created.
func (m *Manager) StartUpload(userID string, req StartRequest, admit func() error) (StartResponse, *BusyReason, error) {
	if userID == "" || req.FileName == "" || req.FileSize <= 0 || req.TotalChunks <= 0 {
		return StartResponse{}, nil, errors.New("invalid_request")
	}
	if req.FileSize > m.maxFileBytes {
		return StartResponse{}, nil, ErrFileTooLarge
	}
	safeName, err := security.SafeUploadFilename(req.FileName)
	if err != nil {
		return StartResponse{}, nil, errors.New("invalid_file_name")
	}
	req.FileName = safeName
	if !isAllowedExtension(req.FileName) {
		return StartResponse{}, nil, errors.New("unsupported_file_type")
	}
	// Exactly as many chunks as the size needs. A larger count would let the
	// upload write past its declared size.
	if int64(req.TotalChunks) != (req.FileSize+m.chunkSize-1)/m.chunkSize {
		return StartResponse{}, nil, errors.New("invalid_chunks")
	}

	m.startMu.Lock()
	defer m.startMu.Unlock()

	if meta, err := findExistingMeta(m.baseDir, userID, req.FileName, req.FileSize); err == nil && meta.ChunkSize == m.chunkSize {
		m.trackActive(meta)
		return StartResponse{UploadID: meta.UploadID, ChunkSize: meta.ChunkSize}, nil, nil
	}
	if reason := m.checkSlots(userID); reason != nil {
		return StartResponse{}, reason, nil
	}
	// One account parks at most one largest file's worth of unfinished
	// uploads; its oldest idle ones make room for the new one.
	m.trimParked(userID, m.maxFileBytes-req.FileSize)
	if reason := m.checkDisk(req.FileSize); reason != nil {
		return StartResponse{}, reason, nil
	}
	if admit != nil {
		if err := admit(); err != nil {
			return StartResponse{}, nil, err
		}
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
	unlock := m.lockUpload(uploadID)
	defer unlock()

	meta, err := readMeta(metaPath(m.baseDir, userID, uploadID))
	if err != nil {
		return ChunkResponse{}, err
	}
	if chunkIndex < 0 || chunkIndex >= meta.TotalChunks {
		return ChunkResponse{}, errors.New("invalid_chunk_index")
	}
	for _, idx := range meta.ReceivedChunks {
		if idx == chunkIndex {
			if meta.JobID == "" {
				m.trackActive(meta)
			}
			return chunkStats(meta, chunkIndex), nil
		}
	}
	want, ok := expectedChunkLen(meta, chunkIndex)
	if !ok {
		return ChunkResponse{}, ErrChunkSize
	}
	if free, err := m.freeSpace(m.baseDir); err == nil {
		if free-want < m.minFreeBytes {
			return ChunkResponse{}, ErrDiskFull
		}
	} else if !errors.Is(err, errNoStatfs) {
		return ChunkResponse{}, err
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
	written, err := io.Copy(file, io.LimitReader(body, want+1))
	if err == nil && written != want {
		err = ErrChunkSize
	}
	if err != nil {
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
	m.trackActive(meta)
	return chunkStats(meta, chunkIndex), nil
}

// BeginComplete checks every chunk is in and claims the upload for queueing,
// so a repeated /complete can never process the same file twice. One already
// queued comes back with its JobID set and nothing claimed. Otherwise the
// caller must end the claim with FinishComplete or AbortComplete.
func (m *Manager) BeginComplete(userID, uploadID string) (CompleteMeta, error) {
	if !ValidUploadID(uploadID) {
		return CompleteMeta{}, ErrInvalidUploadID
	}
	unlock := m.lockUpload(uploadID)
	defer unlock()

	meta, err := readMeta(metaPath(m.baseDir, userID, uploadID))
	if err != nil {
		return CompleteMeta{}, err
	}
	out := CompleteMeta{
		UserID:      userID,
		UploadID:    uploadID,
		FileName:    meta.FileName,
		FileSize:    meta.FileSize,
		TotalChunks: meta.TotalChunks,
		JobID:       meta.JobID,
	}
	if meta.JobID != "" {
		return out, nil
	}
	if len(normalizeChunks(meta.ReceivedChunks)) != meta.TotalChunks {
		return CompleteMeta{}, errors.New("missing_chunks")
	}
	m.activeMu.Lock()
	_, busy := m.completing[uploadID]
	if !busy {
		m.completing[uploadID] = struct{}{}
		delete(m.active, uploadID)
	}
	m.activeMu.Unlock()
	if busy {
		return CompleteMeta{}, ErrCompleteInProgress
	}
	return out, nil
}

// FinishComplete records the job an upload was queued as, so later
// /complete calls answer with it.
func (m *Manager) FinishComplete(userID, uploadID, jobID string) error {
	unlock := m.lockUpload(uploadID)
	defer unlock()
	path := metaPath(m.baseDir, userID, uploadID)
	meta, err := readMeta(path)
	if err == nil {
		meta.JobID = jobID
		err = writeMeta(path, meta)
	}
	if err == nil {
		m.endClaim(uploadID)
	}
	// On failure the claim stays, which still stops a second queueing here.
	return err
}

// AbortComplete lets a later /complete try again after one that did not queue.
func (m *Manager) AbortComplete(uploadID string) {
	m.endClaim(uploadID)
}

func (m *Manager) endClaim(uploadID string) {
	m.activeMu.Lock()
	delete(m.completing, uploadID)
	m.activeMu.Unlock()
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
	unlock := m.lockUpload(uploadID)
	defer unlock()
	m.clearActive(uploadID)
	dir := filepath.Join(m.baseDir, userID, uploadID)
	return os.RemoveAll(dir)
}

// userIDSafe is the same shape the auth middleware accepts (UUID-ish, max 64
// chars, no path separators). Re-applied here so any future caller that
// bypasses the middleware can't pass `../victim` into a filesystem op.
var userIDSafe = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

func (m *Manager) ServerStatus() (ServerStatusResponse, error) {
	usage, err := m.diskUsage()
	if err != nil {
		return ServerStatusResponse{}, err
	}
	m.forgetIdle()
	active := m.activeCount()
	accepting := usage < m.maxDiskBytes && active < m.maxConcurrent
	return ServerStatusResponse{
		AcceptingUploads: accepting,
		ActiveUploads:    active,
		DiskUsageGB:      bytesToGB(usage),
		DiskLimitGB:      bytesToGB(m.maxDiskBytes),
	}, nil
}

func (m *Manager) checkSlots(userID string) *BusyReason {
	m.forgetIdle()
	if m.activeCount() >= m.maxConcurrent {
		return &BusyReason{Reason: "too_many_uploads", RetryAfter: 60}
	}
	if m.userHasActive(userID) {
		return &BusyReason{Reason: "user_active_upload", RetryAfter: 60}
	}
	return nil
}

// checkDisk counts what is on disk plus what running uploads still have to
// send, so many uploads started at once cannot each pass on an empty disk and
// together overflow it. Space short, it reclaims long abandoned uploads first.
func (m *Manager) checkDisk(fileSize int64) *BusyReason {
	usage, err := m.diskUsage()
	if err != nil {
		return nil
	}
	over := func() int64 { return usage + m.reservedBytes() + fileSize*2 - m.maxDiskBytes }
	if need := over(); need >= 0 {
		usage -= m.reclaimStale(need + 1)
	}
	if usage >= m.maxDiskBytes {
		return &BusyReason{Reason: "disk_full", RetryAfter: 60}
	}
	if over() >= 0 {
		return &BusyReason{Reason: "disk_limit", RetryAfter: 60}
	}
	return nil
}

func (m *Manager) reservedBytes() int64 {
	m.activeMu.RLock()
	defer m.activeMu.RUnlock()
	var n int64
	for _, info := range m.active {
		n += info.Remaining
	}
	return n
}

// parkedUpload is an unfinished upload nobody is sending to right now.
type parkedUpload struct {
	userID   string
	uploadID string
	declared int64
	onDisk   int64
	last     time.Time
}

// parkedUploads lists unfinished, unqueued uploads not touched for idleFor,
// oldest first. userID "" lists every user's.
func (m *Manager) parkedUploads(userID string, idleFor time.Duration) []parkedUpload {
	users := []string{userID}
	if userID == "" {
		users = nil
		entries, _ := os.ReadDir(m.baseDir)
		for _, e := range entries {
			if e.IsDir() && userIDSafe.MatchString(e.Name()) {
				users = append(users, e.Name())
			}
		}
	}
	cutoff := time.Now().Add(-idleFor)
	var out []parkedUpload
	for _, u := range users {
		entries, _ := os.ReadDir(filepath.Join(m.baseDir, u))
		for _, e := range entries {
			if !e.IsDir() || !ValidUploadID(e.Name()) || m.isLive(e.Name()) {
				continue
			}
			meta, err := readMeta(metaPath(m.baseDir, u, e.Name()))
			if err != nil || meta.JobID != "" {
				continue
			}
			last := meta.CreatedAt
			if meta.LastActivity.After(last) {
				last = meta.LastActivity
			}
			if last.After(cutoff) {
				continue
			}
			onDisk, _ := m.ChunkFolderSize(u, e.Name())
			out = append(out, parkedUpload{userID: u, uploadID: e.Name(), declared: meta.FileSize, onDisk: onDisk, last: last})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].last.Before(out[j].last) })
	return out
}

// isLive reports an upload that is receiving chunks or being queued.
func (m *Manager) isLive(uploadID string) bool {
	m.activeMu.RLock()
	defer m.activeMu.RUnlock()
	if _, ok := m.completing[uploadID]; ok {
		return true
	}
	info, ok := m.active[uploadID]
	return ok && time.Since(info.LastChunkReceivedAt) < activeIdleLimit
}

// evict deletes a parked upload unless a chunk or /complete got to it first.
func (m *Manager) evict(p parkedUpload) bool {
	unlock := m.lockUpload(p.uploadID)
	defer unlock()
	if m.isLive(p.uploadID) {
		return false
	}
	meta, err := readMeta(metaPath(m.baseDir, p.userID, p.uploadID))
	if err != nil || meta.JobID != "" {
		return false
	}
	if os.RemoveAll(filepath.Join(m.baseDir, p.userID, p.uploadID)) != nil {
		return false
	}
	m.clearActive(p.uploadID)
	return true
}

// trimParked drops a user's oldest idle unfinished uploads until the rest
// declare at most keep bytes.
func (m *Manager) trimParked(userID string, keep int64) {
	list := m.parkedUploads(userID, 0)
	var total int64
	for _, p := range list {
		total += p.declared
	}
	for _, p := range list {
		if total <= keep {
			return
		}
		if m.evict(p) {
			total -= p.declared
		}
	}
}

// reclaimStale frees at least need bytes from uploads nobody has touched in
// reclaimIdleAfter, oldest first, and reports how much it freed.
func (m *Manager) reclaimStale(need int64) int64 {
	var freed int64
	for _, p := range m.parkedUploads("", reclaimIdleAfter) {
		if freed >= need {
			break
		}
		if m.evict(p) {
			freed += p.onDisk
		}
	}
	return freed
}

func (m *Manager) ensureDir(userID, uploadID string) error {
	return os.MkdirAll(filepath.Join(m.baseDir, userID, uploadID), 0700)
}

func (m *Manager) trackActive(meta UploadMeta) {
	remaining := meta.FileSize - int64(len(normalizeChunks(meta.ReceivedChunks)))*meta.ChunkSize
	if remaining < 0 {
		remaining = 0
	}
	m.activeMu.Lock()
	m.active[meta.UploadID] = UploadInfo{
		UserID:              meta.UserID,
		UploadID:            meta.UploadID,
		FileName:            meta.FileName,
		FileSize:            meta.FileSize,
		TotalChunks:         meta.TotalChunks,
		StartedAt:           meta.CreatedAt,
		LastChunkReceivedAt: time.Now().UTC(),
		Remaining:           remaining,
	}
	m.activeMu.Unlock()
}

func (m *Manager) forgetIdle() {
	cutoff := time.Now().UTC().Add(-activeIdleLimit)
	m.activeMu.Lock()
	defer m.activeMu.Unlock()
	for id, info := range m.active {
		if info.LastChunkReceivedAt.Before(cutoff) {
			delete(m.active, id)
		}
	}
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
