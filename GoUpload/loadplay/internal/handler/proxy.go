package handler

import (
	"bytes"
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
	data, err := loadStorageObject(c, deps, st, relPath)
	if err != nil {
		return err
	}
	return sendStorageBytes(c, deps, relPath, data)
}

// streamKeyedObject sends a segment encrypted for one playback, always
// whole: a byte range of ciphertext is no use to the player. It is encrypted
// on the way out, so a cold segment starts reaching the player before it has
// fully downloaded, and no encrypted copy of it is ever held in memory.
func streamKeyedObject(
	c *fiber.Ctx,
	deps ManifestDeps,
	st storage.Config,
	relPath string,
	key []byte,
	seq uint64,
) error {
	mode, err := segmentSealer(key, seq)
	if err != nil {
		deps.Log.Errorf("segment encrypt err=%s", err.Error())
		return deny(c, fiber.StatusInternalServerError)
	}
	src, size, denyErr := openKeyedSource(c, deps, st, relPath)
	if denyErr != nil {
		return denyErr
	}
	setSegmentResponseHeaders(c, deps)
	c.Set("Content-Type", "application/octet-stream")
	// An unknown size goes out chunked. Either way a fetch that fails midway
	// cuts the response short, so the player sees an error and retries.
	streamSize := -1
	if size >= 0 {
		streamSize = sealedSize(size)
	}
	c.Status(fiber.StatusOK).Context().SetBodyStream(newSealingReader(src, mode), streamSize)
	return nil
}

// openKeyedSource is the segment's plaintext and its size (-1 when upstream
// didn't say): the cached copy, or the upstream body as it downloads, which
// goes into the cache once it has arrived whole.
func openKeyedSource(
	c *fiber.Ctx,
	deps ManifestDeps,
	st storage.Config,
	relPath string,
) (io.Reader, int, error) {
	cacheKey := segmentCacheKey(st, relPath)
	if deps.SegmentCache != nil && cacheKey != "" {
		if data, ok := deps.SegmentCache.Get(cacheKey); ok {
			return bytes.NewReader(data), len(data), nil
		}
	}

	res, done, denyErr := openStorageObject(c, deps, st, relPath)
	if denyErr != nil {
		return nil, 0, denyErr
	}
	if res.ContentLength > maxSegmentBytes {
		done()
		deps.Log.Errorf("segment over size cap size=%d path=%s", res.ContentLength, relPath)
		return nil, 0, deny(c, fiber.StatusBadGateway)
	}
	size := int(res.ContentLength)
	fill := newObjectFill(size)
	go func() {
		defer done()
		if err := fill.readFrom(res.Body, maxSegmentBytes); err != nil {
			deps.Log.Errorf("segment read err=%s path=%s", err.Error(), relPath)
			return
		}
		if deps.SegmentCache != nil && cacheKey != "" {
			deps.SegmentCache.Put(cacheKey, fill.bytes())
		}
	}()
	return fill.reader(), size, nil
}

// loadStorageObject is the object's bytes, from the on-disk cache when it
// has them.
func loadStorageObject(
	c *fiber.Ctx,
	deps ManifestDeps,
	st storage.Config,
	relPath string,
) ([]byte, error) {
	key := segmentCacheKey(st, relPath)
	if deps.SegmentCache != nil && key != "" {
		if data, ok := deps.SegmentCache.Get(key); ok {
			return data, nil
		}
	}

	body, denyErr := fetchStorageObject(c, deps, st, relPath)
	if denyErr != nil {
		return nil, denyErr
	}

	// Only cache a full object. A read that hit the byte cap is likely
	// truncated, so skip it rather than serve a corrupt cached copy later.
	if deps.SegmentCache != nil && key != "" && len(body) < maxSegmentBytes {
		deps.SegmentCache.Put(key, body)
	}
	return body, nil
}

func fetchStorageObject(
	c *fiber.Ctx,
	deps ManifestDeps,
	st storage.Config,
	relPath string,
) ([]byte, error) {
	res, done, denyErr := openStorageObject(c, deps, st, relPath)
	if denyErr != nil {
		return nil, denyErr
	}
	defer done()

	body, err := io.ReadAll(io.LimitReader(res.Body, maxSegmentBytes))
	if err != nil {
		deps.Log.Errorf("segment read err=%s path=%s", err.Error(), relPath)
		return nil, deny(c, fiber.StatusBadGateway)
	}
	return body, nil
}

// openStorageObject sends the upstream GET and returns once a 200's headers
// are in. done closes the body and frees the gate slot and timeout, and the
// caller must call it once it has finished reading.
func openStorageObject(
	c *fiber.Ctx,
	deps ManifestDeps,
	st storage.Config,
	relPath string,
) (*http.Response, func(), error) {
	rawURL, err := st.RawURL(relPath)
	if err != nil {
		deps.Log.Errorf("segment storage url err=%s", err.Error())
		return nil, nil, deny(c, fiber.StatusBadRequest)
	}

	// Concurrency cap: under a traffic spike, excess fetches queue briefly and
	// then 503 with Retry-After rather than piling up unbounded in memory.
	release := func() {}
	if deps.FetchGate != nil {
		r, gateErr := deps.FetchGate.Acquire(c.Context())
		if gateErr != nil {
			if gateErr.Error() == "upstream fetch gate busy" {
				c.Set("Retry-After", "2")
				return nil, nil, deny(c, fiber.StatusServiceUnavailable)
			}
			return nil, nil, deny(c, fiber.StatusBadGateway)
		}
		release = r
	}

	// Not tied to the request: a keyed segment keeps downloading after its
	// handler has returned and the response is being written.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	fail := func(status int) (*http.Response, func(), error) {
		cancel()
		release()
		return nil, nil, deny(c, status)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return fail(fiber.StatusBadGateway)
	}
	req.Header.Set("User-Agent", upstreamUserAgent)

	res, err := deps.HTTPClient.Do(req)
	if err != nil {
		deps.Log.Errorf("segment upstream fetch err=%s path=%s", redactUpstreamErr(err), relPath)
		return fail(fiber.StatusBadGateway)
	}
	if res.StatusCode != http.StatusOK {
		res.Body.Close()
		deps.Log.Errorf("segment upstream status=%d path=%s", res.StatusCode, relPath)
		return fail(fiber.StatusBadGateway)
	}
	return res, func() {
		res.Body.Close()
		cancel()
		release()
	}, nil
}

// redirectToR2 answers an R2 segment with a short lived signed link to that
// one object instead of streaming it. Every check in the handler already ran
// for this request, so the token, fingerprint and pace limits still apply;
// only the bytes skip this server.
func redirectToR2(c *fiber.Ctx, deps ManifestDeps, st storage.Config, relPath string) error {
	st.R2TTL = deps.R2Redirect
	signed, err := st.RawURL(relPath)
	if err != nil {
		deps.Log.Errorf("segment presign err=%s", err.Error())
		return deny(c, fiber.StatusBadRequest)
	}
	// The link expires quickly, so neither the browser nor anything between
	// may keep the redirect itself.
	setPlaybackResponseHeaders(c, deps)
	c.Set("Referrer-Policy", "no-referrer")
	return c.Redirect(signed, fiber.StatusFound)
}

// sendStorageBytes returns the object, honoring a Range request by slicing the
// in-memory bytes. No Content-Disposition: a .ts opened in a standalone tab
// triggers download, and those requests are already 403'd before reaching here.
func sendStorageBytes(c *fiber.Ctx, deps ManifestDeps, relPath string, data []byte) error {
	setSegmentResponseHeaders(c, deps)
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
