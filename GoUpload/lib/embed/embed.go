// Package embed talks to the local EmbedAPI sidecar (text -> 384-dim vector).
// Same trust model as lib/nsfw: private network, shared secret, never the
// internet. Disabled (nil results, no error spam) when EMBED_API_URL is unset
// so dev environments without the sidecar keep working.
package embed

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	// MaxTexts mirrors the sidecar's per-request cap.
	MaxTexts = 32
	// Dim is the embedding dimensionality of BAAI/bge-small-en-v1.5.
	Dim = 384
)

type Client struct {
	apiURL string
	secret string
	http   *http.Client
}

func NewClient(apiURL, secret string) *Client {
	return &Client{
		apiURL: apiURL,
		secret: secret,
		http:   &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *Client) Enabled() bool {
	return c != nil && c.apiURL != "" && c.apiURL != "disabled" && c.secret != ""
}

type embedRequest struct {
	Texts []string `json:"texts"`
	Kind  string   `json:"kind"`
}

type embedResponse struct {
	Model   string      `json:"model"`
	Dim     int         `json:"dim"`
	Vectors [][]float32 `json:"vectors"`
}

// Embed returns one vector per text. kind is "query" (user searches) or
// "passage" (documents at upload time) - bge models use different prefixes.
func (c *Client) Embed(ctx context.Context, texts []string, kind string) ([][]float32, error) {
	if !c.Enabled() {
		return nil, nil
	}
	if len(texts) == 0 {
		return nil, nil
	}
	if len(texts) > MaxTexts {
		return nil, fmt.Errorf("too many texts (%d > %d)", len(texts), MaxTexts)
	}
	if kind != "query" {
		kind = "passage"
	}

	body, err := json.Marshal(embedRequest{Texts: texts, Kind: kind})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.apiURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Secret", c.secret)

	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("embed api request failed: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(res.Body, 300))
		return nil, fmt.Errorf("embed api HTTP %d: %s", res.StatusCode, string(snippet))
	}

	// 32 texts x 384 floats is tiny; 4 MiB is a generous cap against a
	// misbehaving sidecar.
	raw, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	var out embedResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	if len(out.Vectors) != len(texts) {
		return nil, fmt.Errorf("embed api returned %d vectors for %d texts", len(out.Vectors), len(texts))
	}
	for _, v := range out.Vectors {
		if len(v) != Dim {
			return nil, fmt.Errorf("unexpected embedding dim %d (want %d)", len(v), Dim)
		}
	}
	return out.Vectors, nil
}
