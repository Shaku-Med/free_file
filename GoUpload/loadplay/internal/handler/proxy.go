package handler

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"goupload/loadplay/lib/storage"
)

const maxSegmentBytes = 64 << 20

// streamStorageObject serves a media object, hitting the on-disk cache first.
// The full object is always fetched and cached, then sliced locally for Range
// requests so the cache fills even when the player asks for byte ranges.
// Access control already ran in the handler before we get here.
func streamStorageObject(
	c *fiber.Ctx,
	deps ManifestDeps,
	st storage.Config,
	relPath string,
) error {
	key := segmentCacheKey(st, relPath)

	if deps.SegmentCache != nil && key != "" {
		if data, ok := deps.SegmentCache.Get(key); ok {
			return sendStorageBytes(c, deps, relPath, data)
		}
	}

	body, denyErr := fetchStorageObject(c, deps, st, relPath)
	if denyErr != nil {
		return denyErr
	}

	// Only cache a full object. A read that hit the byte cap is likely
	// truncated, so skip it rather than serve a corrupt cached copy later.
	if deps.SegmentCache != nil && key != "" && len(body) < maxSegmentBytes {
		deps.SegmentCache.Put(key, body)
	}
	return sendStorageBytes(c, deps, relPath, body)
}

func fetchStorageObject(
	c *fiber.Ctx,
	deps ManifestDeps,
	st storage.Config,
	relPath string,
) ([]byte, error) {
	rawURL, err := st.RawURL(relPath)
	if err != nil {
		deps.Log.Errorf("segment storage url err=%s", err.Error())
		return nil, deny(c, fiber.StatusBadRequest)
	}

	// Concurrency cap: under a traffic spike, excess fetches queue briefly and
	// then 503 with Retry-After rather than piling up unbounded in memory.
	if deps.FetchGate != nil {
		release, gateErr := deps.FetchGate.Acquire(c.Context())
		if gateErr != nil {
			if gateErr.Error() == "upstream fetch gate busy" {
				c.Set("Retry-After", "2")
				return nil, deny(c, fiber.StatusServiceUnavailable)
			}
			return nil, deny(c, fiber.StatusBadGateway)
		}
		defer release()
	}

	ctx, cancel := context.WithTimeout(c.Context(), 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, deny(c, fiber.StatusBadGateway)
	}
	req.Header.Set("User-Agent", upstreamUserAgent)

	res, err := deps.HTTPClient.Do(req)
	if err != nil {
		deps.Log.Errorf("segment upstream fetch err=%s path=%s", redactUpstreamErr(err), relPath)
		return nil, deny(c, fiber.StatusBadGateway)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		deps.Log.Errorf("segment upstream status=%d path=%s", res.StatusCode, relPath)
		return nil, deny(c, fiber.StatusBadGateway)
	}

	body, err := io.ReadAll(io.LimitReader(res.Body, maxSegmentBytes))
	if err != nil {
		deps.Log.Errorf("segment read err=%s path=%s", err.Error(), relPath)
		return nil, deny(c, fiber.StatusBadGateway)
	}
	return body, nil
}

// sendStorageBytes returns the object, honoring a Range request by slicing the
// in-memory bytes. No Content-Disposition: a .ts opened in a standalone tab
// triggers download, and those requests are already 403'd before reaching here.
func sendStorageBytes(c *fiber.Ctx, deps ManifestDeps, relPath string, data []byte) error {
	setPlaybackResponseHeaders(c, deps)
	c.Set("Content-Type", mediaContentType(relPath))
	c.Set("Accept-Ranges", "bytes")

	if rng := strings.TrimSpace(c.Get("Range")); rng != "" {
		if start, end, ok := parseByteRange(rng, len(data)); ok {
			c.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(data)))
			return c.Status(fiber.StatusPartialContent).Send(data[start : end+1])
		}
	}
	return c.Status(fiber.StatusOK).Send(data)
}

// segmentCacheKey mirrors the upstream layout so the cache tree is inspectable
// and collision-free across files/repos. Empty string means do not cache.
func segmentCacheKey(st storage.Config, relPath string) string {
	clean, err := storage.PathFor(relPath)
	if err != nil {
		return ""
	}
	if st.Backend == "r2" {
		bucket := st.Bucket
		if bucket == "" {
			bucket = "default"
		}
		return path.Join("r2", bucket, clean)
	}
	if st.Owner == "" || st.Repo == "" {
		return ""
	}
	branch := st.Branch
	if branch == "" {
		branch = "main"
	}
	return path.Join("github", st.Owner, st.Repo, branch, clean)
}

// parseByteRange handles a single "bytes=a-b", "bytes=a-" or "bytes=-n" range.
// Returns inclusive start/end clamped to the object size.
func parseByteRange(header string, size int) (start, end int, ok bool) {
	if size <= 0 || !strings.HasPrefix(header, "bytes=") {
		return 0, 0, false
	}
	spec := strings.TrimPrefix(header, "bytes=")
	if strings.Contains(spec, ",") {
		return 0, 0, false // multi-range not supported; send full object
	}
	dash := strings.IndexByte(spec, '-')
	if dash < 0 {
		return 0, 0, false
	}
	startStr, endStr := strings.TrimSpace(spec[:dash]), strings.TrimSpace(spec[dash+1:])

	if startStr == "" { // suffix range: last N bytes
		n, err := strconv.Atoi(endStr)
		if err != nil || n <= 0 {
			return 0, 0, false
		}
		if n > size {
			n = size
		}
		return size - n, size - 1, true
	}

	s, err := strconv.Atoi(startStr)
	if err != nil || s < 0 || s >= size {
		return 0, 0, false
	}
	e := size - 1
	if endStr != "" {
		e, err = strconv.Atoi(endStr)
		if err != nil || e < s {
			return 0, 0, false
		}
	}
	if e >= size {
		e = size - 1
	}
	return s, e, true
}

func mediaContentType(relPath string) string {
	switch fileExt(relPath) {
	case "ts":
		return "video/mp2t"
	case "m4s":
		return "video/iso.segment"
	case "mp4":
		return "video/mp4"
	case "vtt":
		return "text/vtt; charset=utf-8"
	case "m3u8", "m2u8":
		return "application/vnd.apple.mpegurl"
	default:
		return "application/octet-stream"
	}
}

func fileExt(relPath string) string {
	if i := strings.LastIndex(relPath, "."); i >= 0 && i < len(relPath)-1 {
		return strings.ToLower(relPath[i+1:])
	}
	return ""
}

const upstreamUserAgent = "Memories-LoadPlay/1.0"
