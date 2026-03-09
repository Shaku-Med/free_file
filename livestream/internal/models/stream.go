package models

import (
	"errors"
	"time"
)

type StreamStatus string

const (
	StreamStatusLive  StreamStatus = "live"
	StreamStatusEnded StreamStatus = "ended"
)

type StreamType string

const (
	StreamTypeRTMP  StreamType = "rtmp"
	StreamTypeWebRTC StreamType = "webrtc"
)

var (
	ErrStreamNotFound = errors.New("stream not found")
	ErrUnauthorized   = errors.New("unauthorized stream key")
	ErrAlreadyBanned  = errors.New("user already banned")
	ErrUpstreamFailed = errors.New("mediamtx upstream request failed")
)

// AuthRequest matches MediaMTX's external authentication webhook payload.
// Fields must stay in sync with MediaMTX config — a mismatch silently fails auth.
type AuthRequest struct {
	IP       string `json:"ip"`
	User     string `json:"user"`
	Password string `json:"password"`
	Path     string `json:"path"`
	Protocol string `json:"protocol"`
	ID       string `json:"id"`
	Action   string `json:"action"`
	Query    string `json:"query"`
}

type StreamEvent struct {
	Path       string `json:"path"`
	Query      string `json:"query"`
	SourceType string `json:"sourceType"`
	SourceID   string `json:"sourceID"`
}

type Stream struct {
	ID         string       `json:"id"`
	Path       string       `json:"path"`
	Status     StreamStatus `json:"status"`
	IngestType StreamType   `json:"ingest_type"`
	StartedAt  *time.Time   `json:"started_at,omitempty"`
	EndedAt    *time.Time   `json:"ended_at,omitempty"`
}

type ViewerCount struct {
	StreamID string `json:"stream_id"`
	Count    int    `json:"count"`
}

type StreamTypeInfo struct {
	StreamID   string     `json:"stream_id"`
	IngestType StreamType `json:"ingest_type"`
}

// WebRTCProxyResponse carries MediaMTX's WHIP/WHEP response back through our proxy.
// Headers like Location and ETag are protocol-critical — dropping them breaks session management.
type WebRTCProxyResponse struct {
	StatusCode  int
	Body        []byte
	ContentType string
	Location    string
	ETag        string
}
