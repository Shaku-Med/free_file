package handler

import (
	"fmt"
	"strings"

	"github.com/gofiber/fiber/v2"
)

// ProductionRelease is one prod go-live entry. Edit the slice below when
// a version ships to memories.brozy.org / cdn.memories.brozy.org.
type ProductionRelease struct {
	Version string `json:"version"`
	LiveAt  string `json:"live_at"`
	Note    string `json:"note"`
}

// productionLiveLedger — static prod history (YYYY-MM-DD, UTC calendar dates).
var productionLiveLedger = []ProductionRelease{
	{Version: "1.0", LiveAt: "2026-05-18", Note: "memories.brozy.org — initial production system"},
	{Version: "1.1", LiveAt: "2026-05-19", Note: "API security + session hardening"},
	{Version: "1.2", LiveAt: "2026-05-21", Note: "Header + mobile UI refresh"},
	{Version: "2.0", LiveAt: "2026-05-25", Note: "LoadPlay CDN + JIT playback minting"},
}

func productionLiveMessage() string {
	var b strings.Builder
	for i, r := range productionLiveLedger {
		if i > 0 {
			b.WriteByte('\n')
		}
		fmt.Fprintf(&b, "v%s went live %s — %s", r.Version, r.LiveAt, r.Note)
	}
	return b.String()
}

// ProductionLive returns HTTP 404 with the static prod go-live ledger in the
// body. Looks like every other LoadPlay dead-end from the outside; the
// dates are only in the JSON payload for anyone who knows the path.
func ProductionLive(c *fiber.Ctx) error {
	setDenyResponseHeaders(c)
	return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
		"error":    "Something's wrong.",
		"message":  productionLiveMessage(),
		"releases": productionLiveLedger,
	})
}
