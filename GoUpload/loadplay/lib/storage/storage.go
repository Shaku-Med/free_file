package storage

import (
	"errors"
	"net/url"
	"path"
	"strings"
)

// Where the real bytes live. Used server-side only  never sent to clients.
type Config struct {
	Owner  string
	Repo   string
	Branch string
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
// this to browsers  proxy through LoadPlay instead.
func (c Config) RawURL(storagePath string) (string, error) {
	clean, err := PathFor(storagePath)
	if err != nil {
		return "", err
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
