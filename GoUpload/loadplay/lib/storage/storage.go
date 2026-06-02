package storage

import (
	"errors"
	"net/url"
	"path"
	"strings"
	"time"

	"goupload/lib/r2"
)

// Where the real bytes live. Used server-side only  never sent to clients.
// Backend selects GitHub raw (default) or Cloudflare R2 per file.
type Config struct {
	Owner   string
	Repo    string
	Branch  string
	Backend string // "github" (default/empty) or "r2"
	Bucket  string // R2 bucket for this file (informational; client carries the active bucket)
	R2      *r2.Client
	R2TTL   time.Duration
}

var ErrUnsafePath = errors.New("unsafe storage path")

// PathFor cleans the request path and rejects path-traversal attempts.
// Token already binds the path the main app intended; this is belt-
// and-suspenders in case anything slips past.
func PathFor(rel string) (string, error) {
	clean := path.Clean("/" + rel)
	if strings.Contains(clean, "..") || clean == "/" {
		return "", ErrUnsafePath
	}
	return strings.TrimPrefix(clean, "/"), nil
}

// RawURL builds the server-side fetch URL for a storage path. Never expose
// this to browsers  proxy through LoadPlay instead. For R2 this is a
// short-lived presigned GET URL (still server-side only).
func (c Config) RawURL(storagePath string) (string, error) {
	clean, err := PathFor(storagePath)
	if err != nil {
		return "", err
	}
	if c.Backend == "r2" {
		if c.R2 == nil {
			return "", errors.New("storage: r2 backend selected but client not configured")
		}
		ttl := c.R2TTL
		if ttl <= 0 {
			ttl = 5 * time.Minute
		}
		return c.R2.PresignGet(clean, ttl)
	}
	if c.Owner == "" || c.Repo == "" {
		return "", errors.New("storage config missing owner/repo")
	}
	branch := c.Branch
	if branch == "" {
		branch = "main"
	}
	// Percent-encode segments; storage paths can contain spaces / special chars.
	parts := strings.Split(clean, "/")
	for i, p := range parts {
		parts[i] = url.PathEscape(p)
	}
	return "https://raw.githubusercontent.com/" + c.Owner + "/" + c.Repo + "/" + branch + "/" + strings.Join(parts, "/"), nil
}
