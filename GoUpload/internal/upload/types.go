package upload

import "time"

const ChunkSizeBytes int64 = 25 << 20

// MaxFileBytesDefault matches MAX_UPLOAD_FILE_BYTES in the app's uploadLimits.ts.
const MaxFileBytesDefault int64 = 10 << 30

type UploadInfo struct {
	UserID              string
	UploadID            string
	FileName            string
	FileSize            int64
	TotalChunks         int
	StartedAt           time.Time
	LastChunkReceivedAt time.Time
	// Bytes still to come, held back from the disk budget for this upload.
	Remaining int64
}

type UploadMeta struct {
	UploadID       string    `json:"upload_id"`
	UserID         string    `json:"user_id"`
	FileName       string    `json:"file_name"`
	FileSize       int64     `json:"file_size"`
	TotalChunks    int       `json:"total_chunks"`
	ChunkSize      int64     `json:"chunk_size"`
	ReceivedChunks []int     `json:"received_chunks"`
	CreatedAt      time.Time `json:"created_at"`
	LastActivity   time.Time `json:"last_activity"`
	// Set once /complete queues the upload, so a repeat answers with the same
	// job instead of processing the file again.
	JobID string `json:"job_id,omitempty"`
}

type StartRequest struct {
	FileName    string `json:"file_name"`
	FileSize    int64  `json:"file_size"`
	TotalChunks int    `json:"total_chunks"`
}

type StartResponse struct {
	UploadID  string `json:"upload_id"`
	ChunkSize int64  `json:"chunk_size"`
}

type StatusResponse struct {
	UploadID       string `json:"upload_id"`
	ReceivedChunks []int  `json:"received_chunks"`
	TotalChunks    int    `json:"total_chunks"`
	CanResume      bool   `json:"can_resume"`
}

type ChunkResponse struct {
	Received      int `json:"received"`
	TotalReceived int `json:"total_received"`
	Remaining     int `json:"remaining"`
}

type CompleteResponse struct {
	Status string `json:"status"`
	JobID  string `json:"job_id"`
}

type CompleteMeta struct {
	UserID      string
	UploadID    string
	FileName    string
	FileSize    int64
	TotalChunks int
	// Non empty when an earlier /complete already queued this upload.
	JobID string
}

type ServerStatusResponse struct {
	AcceptingUploads bool    `json:"accepting_uploads"`
	ActiveUploads    int     `json:"active_uploads"`
	DiskUsageGB      float64 `json:"disk_usage_gb"`
	DiskLimitGB      float64 `json:"disk_limit_gb"`
}

type ManagerConfig struct {
	BaseDir       string
	MaxDiskBytes  int64
	MaxConcurrent int
	ChunkSize     int64
	// Largest single file. MaxFileBytesDefault when unset.
	MaxFileBytes int64
	// Chunks are refused while the disk has less than this free, whatever the
	// budget says, so uploads can never fill the box. 2 GiB when unset.
	MinFreeBytes int64
}

type BusyReason struct {
	Reason     string
	RetryAfter int
}
