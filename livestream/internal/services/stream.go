package services

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"livestream/internal/models"
	"livestream/lib"
)

type StreamService interface {
	Authenticate(ctx context.Context, req *models.AuthRequest) error
	AuthenticateKey(ctx context.Context, streamKey string) error
	StartStream(ctx context.Context, event *models.StreamEvent) (*models.Stream, error)
	EndStream(ctx context.Context, event *models.StreamEvent) error
	GetStream(ctx context.Context, id string) (*models.Stream, error)
	GetStreamType(ctx context.Context, id string) (*models.StreamTypeInfo, error)
	GetViewerCount(ctx context.Context, streamID string) (*models.ViewerCount, error)
	BanUser(ctx context.Context, streamID, userID string) error
	ProxyWHIP(ctx context.Context, streamKey string, offer []byte, contentType string) (*models.WebRTCProxyResponse, error)
	ProxyWHEP(ctx context.Context, streamKey string, offer []byte, contentType string) (*models.WebRTCProxyResponse, error)
}

type streamService struct {
	mediamtxURL string
	httpClient  *http.Client
}

func NewStreamService(mediamtxURL string) StreamService {
	return &streamService{
		mediamtxURL: strings.TrimRight(mediamtxURL, "/"),
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (s *streamService) validateKey(ctx context.Context, key string) error {
	// TODO: check stream key against database
	return nil
}

func (s *streamService) Authenticate(ctx context.Context, req *models.AuthRequest) error {
	return s.validateKey(ctx, req.Password)
}

func (s *streamService) AuthenticateKey(ctx context.Context, streamKey string) error {
	return s.validateKey(ctx, streamKey)
}

func (s *streamService) StartStream(ctx context.Context, event *models.StreamEvent) (*models.Stream, error) {
	// TODO: persist stream record, notify subscribers
	ingestType := models.StreamTypeRTMP
	if event.SourceType == "webRTCSource" {
		ingestType = models.StreamTypeWebRTC
	}

	now := time.Now()
	return &models.Stream{
		ID:         event.Path,
		Path:       event.Path,
		Status:     models.StreamStatusLive,
		IngestType: ingestType,
		StartedAt:  &now,
	}, nil
}

func (s *streamService) EndStream(ctx context.Context, event *models.StreamEvent) error {
	// TODO: update stream status, calculate duration, finalize VOD
	return nil
}

func (s *streamService) GetStream(ctx context.Context, id string) (*models.Stream, error) {
	// TODO: fetch from database
	return nil, models.ErrStreamNotFound
}

func (s *streamService) GetStreamType(ctx context.Context, id string) (*models.StreamTypeInfo, error) {
	// TODO: look up from persisted stream record
	return nil, models.ErrStreamNotFound
}

func (s *streamService) GetViewerCount(ctx context.Context, streamID string) (*models.ViewerCount, error) {
	// TODO: pull from real-time counter (Redis or in-memory)
	return &models.ViewerCount{
		StreamID: streamID,
		Count:    0,
	}, nil
}

func (s *streamService) BanUser(ctx context.Context, streamID, userID string) error {
	// TODO: persist ban, disconnect user via MediaMTX API
	return nil
}

// proxyWebRTC forwards an SDP offer to MediaMTX and returns the response.
// Both WHIP (publish) and WHEP (subscribe) use the same request/response shape.
func (s *streamService) proxyWebRTC(ctx context.Context, streamKey, protocol string, offer []byte, contentType string) (*models.WebRTCProxyResponse, error) {
	url := fmt.Sprintf("%s/%s/%s", s.mediamtxURL, streamKey, protocol)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(offer))
	if err != nil {
		return nil, fmt.Errorf("create %s request: %w", protocol, err)
	}
	req.Header.Set("Content-Type", contentType)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s proxy: %w", protocol, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, int64(lib.MaxBodySize)))
	if err != nil {
		return nil, fmt.Errorf("read %s response: %w", protocol, err)
	}

	return &models.WebRTCProxyResponse{
		StatusCode:  resp.StatusCode,
		Body:        body,
		ContentType: resp.Header.Get("Content-Type"),
		Location:    resp.Header.Get("Location"),
		ETag:        resp.Header.Get("ETag"),
	}, nil
}

func (s *streamService) ProxyWHIP(ctx context.Context, streamKey string, offer []byte, contentType string) (*models.WebRTCProxyResponse, error) {
	return s.proxyWebRTC(ctx, streamKey, "whip", offer, contentType)
}

func (s *streamService) ProxyWHEP(ctx context.Context, streamKey string, offer []byte, contentType string) (*models.WebRTCProxyResponse, error) {
	return s.proxyWebRTC(ctx, streamKey, "whep", offer, contentType)
}
