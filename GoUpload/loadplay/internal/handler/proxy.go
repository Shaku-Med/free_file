package handler

import (
	"context"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"goupload/loadplay/lib/storage"
)

const maxSegmentBytes = 64 << 20

func streamStorageObject(
	c *fiber.Ctx,
	deps ManifestDeps,
	st storage.Config,
	relPath string,
) error {
	rawURL, err := st.RawURL(relPath)
	if err != nil {
		deps.Log.Errorf("segment storage url err=%s", err.Error())
		return deny(c, fiber.StatusBadRequest)
	}

	// Concurrency cap: same gate as the manifest fetch. Under a traffic
	// spike, excess fetches queue briefly and then 503 with Retry-After
	// rather than piling up unbounded in memory.
	if deps.FetchGate != nil {
		release, gateErr := deps.FetchGate.Acquire(c.Context())
		if gateErr != nil {
			if gateErr.Error() == "upstream fetch gate busy" {
				c.Set("Retry-After", "2")
				return deny(c, fiber.StatusServiceUnavailable)
			}
			return deny(c, fiber.StatusBadGateway)
		}
		defer release()
	}

	ctx, cancel := context.WithTimeout(c.Context(), 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return deny(c, fiber.StatusBadGateway)
	}
	req.Header.Set("User-Agent", upstreamUserAgent)
	if rng := strings.TrimSpace(c.Get("Range")); rng != "" {
		req.Header.Set("Range", rng)
	}

	res, err := deps.HTTPClient.Do(req)
	if err != nil {
		deps.Log.Errorf("segment upstream fetch err=%s path=%s", err.Error(), relPath)
		return deny(c, fiber.StatusBadGateway)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusPartialContent {
		deps.Log.Errorf("segment upstream status=%d path=%s", res.StatusCode, relPath)
		return deny(c, fiber.StatusBadGateway)
	}

	body, err := io.ReadAll(io.LimitReader(res.Body, maxSegmentBytes))
	if err != nil {
		deps.Log.Errorf("segment read err=%s path=%s", err.Error(), relPath)
		return deny(c, fiber.StatusBadGateway)
	}

	setPlaybackResponseHeaders(c, deps)
	c.Set("Content-Type", mediaContentType(relPath))
	// No Content-Disposition — .ts in a standalone tab triggers download;
	// those requests must 403 before we reach here.
	if res.StatusCode == http.StatusPartialContent {
		if cr := res.Header.Get("Content-Range"); cr != "" {
			c.Set("Content-Range", cr)
		}
		return c.Status(fiber.StatusPartialContent).Send(body)
	}
	return c.Status(fiber.StatusOK).Send(body)
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
