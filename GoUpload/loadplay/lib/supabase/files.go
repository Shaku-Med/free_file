package supabase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// FileMeta is everything LoadPlay needs to make an access decision for a
// single file. Kept tiny on purpose  the more columns we pull, the
// more pressure on the DB and the slower the cache fill.
type FileMeta struct {
	ID             string
	GithubRepo     string
	StorageBackend string // "github" (default) or "r2"
	StorageBucket  string // R2 bucket when StorageBackend == "r2"
	OwnerID        string
	IsPublic       bool
	// Visibility is the authoritative three state value ("public", "unlisted",
	// "private"). IsPublic is only (visibility = 'public'), so gating playback
	// on IsPublic alone would make every UNLISTED file owner only, which is the
	// opposite of what unlisted means. Empty when the migration has not run;
	// OwnerOnly() falls back to IsPublic in that case.
	Visibility string
	IsAdult    bool
	// OwnerStatus is the owner's account_status ("active", "strike",
	// "restricted", "terminated"). Empty when the moderation migration hasn't
	// run yet, which is treated as active — see accountBlocked().
	OwnerStatus string
	// OwnerStatusExpires is when a "restricted" status lapses (RFC3339, may be
	// empty). Checked so enforcement doesn't linger past its expiry if the
	// sweep hasn't run.
	OwnerStatusExpires string
	Exists             bool
}

// AccountBlocked reports whether this file must be withheld because of the
// OWNER'S account standing, rather than the file's own flags.
//
// Enforced here, not just at token-mint time in the app: a playback token
// minted BEFORE a ban stays valid until it expires (TTL tracks video length,
// up to 6h), so mint-time checks alone would leave a multi-hour window in which
// a banned account's media keeps streaming.
//
// Unknown/empty status means the moderation columns aren't deployed yet, which
// must read as ALLOWED — failing closed on a missing column would blank every
// video on the platform.
// OwnerOnly reports whether only the owner may play this file.
//
//	public    no
//	unlisted  no. Not listed anywhere, but anyone holding the link may watch,
//	          which is the entire point of the state.
//	private   yes
//
// Falls back to IsPublic when Visibility is empty (migration not applied yet),
// which keeps the old behaviour rather than opening anything up.
func (m *FileMeta) OwnerOnly() bool {
	switch m.Visibility {
	case "public", "unlisted":
		return false
	case "private":
		return true
	default:
		return !m.IsPublic
	}
}

func (m *FileMeta) AccountBlocked() bool {
	switch m.OwnerStatus {
	case "restricted":
		if m.OwnerStatusExpires != "" {
			if t, err := time.Parse(time.RFC3339, m.OwnerStatusExpires); err == nil && !t.After(time.Now()) {
				return false // lapsed
			}
		}
		return true
	case "terminated":
		return true
	default:
		return false
	}
}

// ErrNotFound is returned (and cached) when the row is missing. The
// caller can treat it as a 404 and remember it for a short window so
// scan attempts don't pound the DB.
var ErrNotFound = errors.New("file not found")

// Client is the minimum surface  base URL + service role key. Both
// from env, never hardcoded.
type Client struct {
	BaseURL    string
	ServiceKey string
	HTTPClient *http.Client
}

func New(baseURL, serviceKey string) *Client {
	return &Client{
		BaseURL:    strings.TrimRight(baseURL, "/"),
		ServiceKey: serviceKey,
		HTTPClient: &http.Client{Timeout: 8 * time.Second},
	}
}

// GetFileMeta loads a file row by public `unique_id` (the value in URLs
// and playback tokens  NOT the internal UUID primary key). Service-role
// key only; never exposed to the browser.
func (c *Client) GetFileMeta(ctx context.Context, uniqueID string) (*FileMeta, error) {
	if c.BaseURL == "" || c.ServiceKey == "" {
		return nil, errors.New("supabase client not configured")
	}
	if !isValidUniqueID(uniqueID) {
		return nil, ErrNotFound
	}

	reqURL := fmt.Sprintf(
		"%s/rest/v1/files?unique_id=eq.%s&select=id,github_repo,storage_backend,storage_bucket,owner_id,is_public,visibility,is_adult&limit=1",
		c.BaseURL, url.QueryEscape(uniqueID),
	)
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", c.ServiceKey)
	req.Header.Set("Authorization", "Bearer "+c.ServiceKey)
	req.Header.Set("Accept", "application/json")

	res, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("supabase %d", res.StatusCode)
	}
	var rows []struct {
		ID             string  `json:"id"`
		GithubRepo     *string `json:"github_repo"`
		StorageBackend *string `json:"storage_backend"`
		StorageBucket  *string `json:"storage_bucket"`
		OwnerID        *string `json:"owner_id"`
		IsPublic       *bool   `json:"is_public"`
		Visibility     *string `json:"visibility"`
		IsAdult        *bool   `json:"is_adult"`
	}
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	r := rows[0]
	meta := &FileMeta{
		ID:     r.ID,
		Exists: true,
	}
	if r.GithubRepo != nil {
		meta.GithubRepo = strings.TrimSpace(*r.GithubRepo)
	}
	if r.StorageBackend != nil {
		meta.StorageBackend = strings.TrimSpace(*r.StorageBackend)
	}
	if r.StorageBucket != nil {
		meta.StorageBucket = strings.TrimSpace(*r.StorageBucket)
	}
	if r.OwnerID != nil {
		meta.OwnerID = *r.OwnerID
	}
	if r.IsPublic != nil {
		meta.IsPublic = *r.IsPublic
	}
	if r.Visibility != nil {
		meta.Visibility = strings.TrimSpace(*r.Visibility)
	}
	if r.IsAdult != nil {
		meta.IsAdult = *r.IsAdult
	}
	// Owner account standing. Deliberately a SECOND request rather than a
	// PostgREST embed: files.owner_id has no FK to users, so `users(...)` is
	// ambiguous (PGRST201 — it resolves to the saved_files / watch-history
	// many-to-many joins instead) and would break every lookup.
	//
	// Cost is bounded: the caller caches FileMeta, so this runs once per file
	// per cache window, not per segment.
	if meta.OwnerID != "" {
		if status, expires, err := c.getOwnerStatus(ctx, meta.OwnerID); err == nil {
			meta.OwnerStatus = status
			meta.OwnerStatusExpires = expires
		}
		// On error we leave the status empty, which AccountBlocked() reads as
		// active. A moderation lookup failure must not take down playback.
	}

	return meta, nil
}

// getOwnerStatus reads the owner's moderation standing. Returns empty strings
// when the moderation columns don't exist yet (migration not applied), which
// callers treat as "active".
func (c *Client) getOwnerStatus(ctx context.Context, ownerID string) (string, string, error) {
	endpoint := fmt.Sprintf(
		"%s/rest/v1/users?id=eq.%s&select=account_status,status_expires_at&limit=1",
		strings.TrimRight(c.BaseURL, "/"), url.QueryEscape(ownerID),
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("apikey", c.ServiceKey)
	req.Header.Set("Authorization", "Bearer "+c.ServiceKey)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		// 400 here means the columns aren't deployed yet — not an outage.
		return "", "", nil
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if err != nil {
		return "", "", err
	}
	var rows []struct {
		AccountStatus   *string `json:"account_status"`
		StatusExpiresAt *string `json:"status_expires_at"`
	}
	if err := json.Unmarshal(body, &rows); err != nil || len(rows) == 0 {
		return "", "", nil
	}
	var status, expires string
	if rows[0].AccountStatus != nil {
		status = strings.TrimSpace(*rows[0].AccountStatus)
	}
	if rows[0].StatusExpiresAt != nil {
		expires = strings.TrimSpace(*rows[0].StatusExpiresAt)
	}
	return status, expires, nil
}

func isValidUniqueID(s string) bool {
	if len(s) < 8 || len(s) > 128 {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-':
			continue
		default:
			return false
		}
	}
	return true
}
