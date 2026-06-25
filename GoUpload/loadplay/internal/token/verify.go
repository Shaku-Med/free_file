package token

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// Playback token issued by the main app, validated here. Field names are
// short to keep the URL compact when this rides as a query param.
type Playback struct {
	FileID string `json:"f"` // files.unique_id (public id), not the UUID row id
	UserID string `json:"u,omitempty"`
	Path   string `json:"p"`
	Exp    int64  `json:"e"`
	IPHash      string `json:"i,omitempty"`
	UAHash      string `json:"a,omitempty"`
	Nonce       string `json:"n,omitempty"`
	GuestLimit  int64  `json:"g,omitempty"` // guest preview cap (seconds); app-minted only
	Cast        int    `json:"c,omitempty"` // 1 = cast device token (no browser origin/UA)
}

// IsCast reports whether this token was minted for a Cast/TV device, which has
// no browser Origin/Referer and a different UA. Such tokens skip the origin
// guard + UA bind but still enforce IP scope + nonce + expiry.
func (p *Playback) IsCast() bool {
	return p.Cast != 0
}

const maxGuestPreviewSec = 600

func (p *Playback) IsGuest() bool {
	return p.UserID == ""
}

// GuestPreviewSeconds returns the signed preview cap for guest tokens.
func (p *Playback) GuestPreviewSeconds() int {
	if !p.IsGuest() {
		return 0
	}
	g := int(p.GuestLimit)
	if g <= 0 {
		return 0
	}
	if g > maxGuestPreviewSec {
		return maxGuestPreviewSec
	}
	return g
}

// Format on the wire: base64url(json).base64url(hmac).
// Same shape as JWT-compact minus the algorithm header  algorithm is fixed.
const sep = "."

var (
	ErrInvalidFormat = errors.New("invalid token format")
	ErrBadSignature  = errors.New("signature mismatch")
	ErrExpired       = errors.New("token expired")
)

func Encode(payload Playback, secret []byte) (string, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	bodyB64 := base64.RawURLEncoding.EncodeToString(body)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(bodyB64))
	sig := mac.Sum(nil)
	return bodyB64 + sep + base64.RawURLEncoding.EncodeToString(sig), nil
}

// Verify decodes, checks HMAC, checks expiry. Returns the payload on
// success. Caller should additionally validate fingerprint binding
// (IP/UA hash) against the live request.
func Verify(raw string, secret []byte) (*Playback, error) {
	parts := strings.Split(raw, sep)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return nil, ErrInvalidFormat
	}
	provided, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, ErrInvalidFormat
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(parts[0]))
	expected := mac.Sum(nil)
	if !hmac.Equal(provided, expected) {
		return nil, ErrBadSignature
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, ErrInvalidFormat
	}
	var p Playback
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, ErrInvalidFormat
	}
	if p.Exp <= time.Now().UnixMilli() {
		return nil, ErrExpired
	}
	return &p, nil
}
