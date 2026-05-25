package guest

import (
	"path"
	"strings"
	"sync"
	"time"
)

// Allowlist remembers segment paths a guest token may fetch after we serve
// a truncated media playlist — blocks direct .ts URL guessing with the
// same ?t= token.
type Allowlist struct {
	ttl time.Duration
	mu  sync.Mutex
	// sessionKey → allowed storage-relative paths
	items map[string]*entry
}

type entry struct {
	paths map[string]struct{}
	exp   time.Time
}

func NewAllowlist(ttl time.Duration) *Allowlist {
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	return &Allowlist{ttl: ttl, items: make(map[string]*entry)}
}

func (a *Allowlist) Register(sessionKey string, manifestPath string, playlistBody string) {
	if sessionKey == "" || playlistBody == "" {
		return
	}
	paths := CollectMediaResourcePaths(manifestPath, playlistBody)
	if len(paths) == 0 {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.sweepLocked(time.Now())
	set := make(map[string]struct{}, len(paths))
	for _, p := range paths {
		set[p] = struct{}{}
	}
	if existing, ok := a.items[sessionKey]; ok && time.Now().Before(existing.exp) {
		for p := range existing.paths {
			set[p] = struct{}{}
		}
	}
	a.items[sessionKey] = &entry{paths: set, exp: time.Now().Add(a.ttl)}
}

func (a *Allowlist) Allowed(sessionKey, storagePath string) bool {
	candidates := normalizeStoragePaths(storagePath)
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	a.sweepLocked(now)
	e, ok := a.items[sessionKey]
	if !ok {
		return false
	}
	if now.After(e.exp) {
		delete(a.items, sessionKey)
		return false
	}
	for _, p := range candidates {
		if _, ok := e.paths[p]; ok {
			return true
		}
	}
	return false
}

func normalizeStoragePaths(storagePath string) []string {
	raw := strings.TrimSpace(storagePath)
	if raw == "" {
		return nil
	}
	clean := path.Clean(strings.TrimPrefix(raw, "/"))
	if clean == "." {
		return nil
	}
	out := []string{clean}
	if alt := strings.TrimPrefix(raw, "/"); alt != clean {
		out = append(out, path.Clean(alt))
	}
	return out
}

func (a *Allowlist) sweepLocked(now time.Time) {
	for k, e := range a.items {
		if now.After(e.exp) {
			delete(a.items, k)
		}
	}
}

// CollectMediaResourcePaths resolves segment/init URIs from a media playlist.
func CollectMediaResourcePaths(manifestPath, body string) []string {
	dir := path.Dir(manifestPath)
	if dir == "." {
		dir = ""
	}
	lines := strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n")
	seen := make(map[string]struct{})
	var out []string
	add := func(ref string) {
		ref = strings.TrimSpace(ref)
		if ref == "" || strings.HasPrefix(ref, "http://") || strings.HasPrefix(ref, "https://") {
			return
		}
		full := resolveUnderDir(dir, ref)
		if full == "" {
			return
		}
		if _, ok := seen[full]; ok {
			return
		}
		seen[full] = struct{}{}
		out = append(out, full)
	}
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "#") {
			if idx := strings.Index(trimmed, `URI="`); idx >= 0 {
				rest := trimmed[idx+5:]
				if end := strings.Index(rest, `"`); end >= 0 {
					add(rest[:end])
				}
			}
			continue
		}
		add(trimmed)
		_ = i
	}
	return out
}

func resolveUnderDir(dir, ref string) string {
	ref = strings.Split(ref, "?")[0]
	ref = strings.Split(ref, "#")[0]
	if ref == "" {
		return ""
	}
	if dir == "" {
		return path.Clean(ref)
	}
	return path.Clean(dir + "/" + ref)
}
