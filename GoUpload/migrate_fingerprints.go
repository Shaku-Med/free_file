package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"goupload/lib/fingerprintdb"
	"goupload/lib/logger"
)

// runFingerprintMigration copies the Supabase `audio_fingerprints` table into
// the local SQLite store, re-keying rows from the internal file uuid to the
// public unique_id (which is what the local matcher keys on).
//
// One-time, idempotent-ish: it refuses to run if the local store already holds
// rows, so a double-run can't duplicate the catalog. Reads Supabase via REST
// with the service key; writes go through the injection-safe BulkInsert.
func runFingerprintMigration(dbPath string, appLog *logger.Logger) error {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("SUPABASE_URL")), "/")
	key := strings.TrimSpace(os.Getenv("SUPABASE_SERVICE_KEY"))
	if key == "" {
		key = strings.TrimSpace(os.Getenv("SUPABASE_ANON_KEY")) // app's name for the service JWT
	}
	if base == "" || key == "" {
		return fmt.Errorf("SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY) must be set")
	}

	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return fmt.Errorf("db dir: %w", err)
	}
	db, err := fingerprintdb.Open(dbPath, env0MaxBytes())
	if err != nil {
		return fmt.Errorf("open sqlite: %w", err)
	}
	defer db.Close()

	ctx := context.Background()
	if n, err := db.Count(ctx); err != nil {
		return fmt.Errorf("count: %w", err)
	} else if n > 0 {
		return fmt.Errorf("local store already has %d rows; refusing to import twice (delete %s to force)", n, dbPath)
	}

	client := &http.Client{Timeout: 60 * time.Second}
	const page = 1000
	offset := 0
	total := 0
	for {
		rows, err := fetchFingerprintPage(ctx, client, base, key, offset, page)
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			break
		}
		n, err := db.BulkInsert(ctx, rows)
		if err != nil {
			return fmt.Errorf("bulk insert at offset %d: %w", offset, err)
		}
		total += n
		appLog.Infof("fingerprint migration: imported %d (offset %d, +%d)", total, offset, n)
		if len(rows) < page {
			break
		}
		offset += page
	}

	appLog.Infof("fingerprint migration complete: %d rows in %s", total, dbPath)
	return nil
}

// env0MaxBytes mirrors main's cap so the migrator writes under the same limit.
func env0MaxBytes() int64 {
	// Reuse the same env the runtime uses; default 10 GiB.
	if v := strings.TrimSpace(os.Getenv("FINGERPRINT_DB_MAX_BYTES")); v != "" {
		var n int64
		if _, err := fmt.Sscan(v, &n); err == nil && n > 0 {
			return n
		}
	}
	return 10 << 30
}

// supaFPRow is the PostgREST shape with the embedded files.unique_id.
type supaFPRow struct {
	Hash    json.Number `json:"hash"`
	TOffset json.Number `json:"t_offset"`
	Files   *struct {
		UniqueID string `json:"unique_id"`
	} `json:"files"`
}

func fetchFingerprintPage(
	ctx context.Context,
	client *http.Client,
	base, key string,
	offset, limit int,
) ([]fingerprintdb.Row, error) {
	// Embed files!inner(unique_id) so each print carries its public id. Order
	// by a stable key for consistent paging.
	url := fmt.Sprintf(
		"%s/rest/v1/audio_fingerprints?select=hash,t_offset,files!inner(unique_id)&order=file_id.asc&limit=%d&offset=%d",
		base, limit, offset,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", key)
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")

	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("supabase GET: %w", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 32<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("supabase GET %d: %s", res.StatusCode, strings.TrimSpace(string(body)))
	}

	var raw []supaFPRow
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("decode page: %w", err)
	}

	out := make([]fingerprintdb.Row, 0, len(raw))
	for _, r := range raw {
		if r.Files == nil || r.Files.UniqueID == "" {
			continue
		}
		h, err := r.Hash.Int64()
		if err != nil {
			continue
		}
		o, err := r.TOffset.Int64()
		if err != nil {
			continue
		}
		out = append(out, fingerprintdb.Row{
			Hash:     uint32(h),
			UniqueID: r.Files.UniqueID,
			Offset:   int32(o),
		})
	}
	return out, nil
}
