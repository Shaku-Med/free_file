// Package fingerprintdb is the on-VPS audio-fingerprint store + matcher.
//
// It replaces the Supabase `audio_fingerprints` table and the
// `register_audio_fingerprints` RPC: GoUpload already computes the hashes on
// the box, so matching them here means the raw fingerprints never leave the
// VPS and Supabase only ever stores the resulting `original_file_id` link.
//
// The matcher is a behaviour-for-behaviour port of the v5 SQL (see
// app/database/V2/audio_fingerprints_v5.sql): distinct-hash votes per
// (file, offset-delta), stop-word hashes (>16x in the query) excluded, and a
// ratio gate so an alignment must cover a real fraction of the query's hashes.
//
// Security: every value reaches SQLite as a bound `?` parameter — there is no
// string interpolation of caller data anywhere, so SQL injection is
// structurally impossible. unique_id is additionally validated against a tight
// allowlist pattern before use.
package fingerprintdb

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"regexp"
	"strings"
	"sync"

	_ "modernc.org/sqlite"
)

// Matcher constants — keep in lockstep with audio_fingerprints_v5.sql.
const (
	// MatchRatio: the winning alignment must cover at least this fraction of
	// the query's distinct (non stop-word) hashes.
	matchRatio = 0.18
	// stopWordMax: a hash appearing more than this many times in ONE query is
	// periodic-beat noise and is excluded from voting.
	stopWordMax = 16
	// defaultMinVotes mirrors the RPC's p_min_votes default.
	DefaultMinVotes = 25
	// maxQueryHashes caps a single register call (matches the RPC's guard).
	maxQueryHashes = 10000
	// storedFanoutCap: a hash present in more than this many stored rows is
	// treated as noise for THIS lookup and skipped — a defensive bound so one
	// pathological hash can't make a match scan the whole table. Far above any
	// legitimate per-song count; only trips on garbage/attack input.
	storedFanoutCap = 4000
	// batchSize keeps the IN(...) placeholder count under SQLite's default
	// 999-parameter limit (+1 for the unique_id bind).
	batchSize = 400
	// sqlitePageSize is the WAL default; used to translate the byte cap into a
	// max_page_count. Must match the actual page size (we never change it).
	sqlitePageSize = 4096
)

var uniqueIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// DB is the fingerprint store. Safe for concurrent use; writes (and the
// match-then-write critical section) are serialized so two uploads finishing
// at once can't both decide they are the original of the same song.
type DB struct {
	sql *sql.DB
	mu  sync.Mutex
}

// Result is the outcome of a Register call.
type Result struct {
	Matched          bool
	OriginalUniqueID string
	Votes            int
	OffsetDelta      int
	// Stored is true when this upload's prints were written (non-reel, no
	// match, and the size cap wasn't hit).
	Stored bool
}

// Open opens/creates the SQLite fingerprint DB at path and hard-caps its size
// at maxBytes (0 = a 10 GiB default). WAL mode + a busy timeout make it safe
// across process crashes and reboots; the file lives on a docker volume so it
// survives container recreation.
func Open(path string, maxBytes int64) (*DB, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("fingerprintdb: empty path")
	}
	if maxBytes <= 0 {
		maxBytes = 10 * 1024 * 1024 * 1024 // 10 GiB
	}
	maxPages := maxBytes / sqlitePageSize
	if maxPages < 1024 {
		maxPages = 1024
	}

	// Pragmas travel in the DSN so every pooled connection gets them.
	dsn := fmt.Sprintf(
		"file:%s?_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(OFF)&_pragma=temp_store(MEMORY)&_pragma=max_page_count(%d)",
		path, maxPages,
	)

	sdb, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("fingerprintdb: open: %w", err)
	}
	// WAL is single-writer; a small pool is plenty and avoids lock churn.
	sdb.SetMaxOpenConns(4)
	sdb.SetMaxIdleConns(2)

	db := &DB{sql: sdb}
	if err := db.migrate(); err != nil {
		_ = sdb.Close()
		return nil, err
	}
	return db, nil
}

func (d *DB) migrate() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS audio_fingerprints (
			hash      INTEGER NOT NULL,
			unique_id TEXT    NOT NULL,
			t_offset  INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_af_hash ON audio_fingerprints (hash)`,
		`CREATE INDEX IF NOT EXISTS idx_af_uid  ON audio_fingerprints (unique_id)`,
	}
	for _, s := range stmts {
		if _, err := d.sql.Exec(s); err != nil {
			return fmt.Errorf("fingerprintdb: migrate: %w", err)
		}
	}
	return nil
}

// Close closes the database.
func (d *DB) Close() error { return d.sql.Close() }

// Count returns the total number of stored fingerprint rows (for migration
// verification / health).
func (d *DB) Count(ctx context.Context) (int64, error) {
	var n int64
	err := d.sql.QueryRowContext(ctx, `SELECT COUNT(*) FROM audio_fingerprints`).Scan(&n)
	return n, err
}

// ValidUniqueID reports whether s is a safe unique_id.
func ValidUniqueID(s string) bool { return uniqueIDPattern.MatchString(s) }

type voteKey struct {
	uid   string
	delta int
}

// Register matches this upload's fingerprint against the catalog and, when it
// is a genuinely new original (non-reel, no match), stores its prints. Ports
// register_audio_fingerprints v5 exactly.
func (d *DB) Register(
	ctx context.Context,
	uniqueID string,
	isReel bool,
	hashes []uint32,
	offsets []int32,
	minVotes int,
) (Result, error) {
	if !ValidUniqueID(uniqueID) {
		return Result{}, fmt.Errorf("fingerprintdb: invalid unique_id")
	}
	if len(hashes) == 0 || len(hashes) != len(offsets) || len(hashes) > maxQueryHashes {
		return Result{}, fmt.Errorf("fingerprintdb: invalid fingerprint arrays")
	}
	if minVotes <= 0 {
		minVotes = DefaultMinVotes
	}

	// Clean: drop stop-word hashes (>stopWordMax occurrences in the query).
	counts := make(map[uint32]int, len(hashes))
	for _, h := range hashes {
		counts[h]++
	}
	qByHash := make(map[uint32][]int32, len(hashes))
	for i, h := range hashes {
		if counts[h] > stopWordMax {
			continue
		}
		qByHash[h] = append(qByHash[h], offsets[i])
	}
	distinctTotal := len(qByHash)

	// Serialize the whole match-then-write section: prevents two simultaneous
	// uploads of the same song from both being stored as originals. Held for
	// every DB path below (including the early no-distinct return).
	d.mu.Lock()
	defer d.mu.Unlock()

	if distinctTotal == 0 {
		// Everything was periodic noise; nothing to match on. Treat as a
		// non-match original (store raw prints) to stay v5-equivalent.
		return d.finalize(ctx, uniqueID, isReel, hashes, offsets, Result{})
	}

	need := minVotes
	if r := int(math.Ceil(matchRatio * float64(distinctTotal))); r > need {
		need = r
	}

	distinct := make([]uint32, 0, len(qByHash))
	for h := range qByHash {
		distinct = append(distinct, h)
	}

	votes := make(map[voteKey]map[uint32]struct{})
	for start := 0; start < len(distinct); start += batchSize {
		end := start + batchSize
		if end > len(distinct) {
			end = len(distinct)
		}
		chunk := distinct[start:end]
		if err := d.scanChunk(ctx, uniqueID, chunk, qByHash, votes); err != nil {
			return Result{}, err
		}
	}

	// Best alignment by distinct-hash votes.
	var bestKey voteKey
	best := 0
	for k, set := range votes {
		if len(set) > best {
			best = len(set)
			bestKey = k
		}
	}

	res := Result{}
	if best >= need {
		res.Matched = true
		res.OriginalUniqueID = bestKey.uid
		res.Votes = best
		res.OffsetDelta = bestKey.delta
	}

	return d.finalize(ctx, uniqueID, isReel, hashes, offsets, res)
}

// scanChunk fetches stored rows for a batch of query hashes and accumulates
// distinct-hash votes per (stored unique_id, offset delta). Caller holds mu.
func (d *DB) scanChunk(
	ctx context.Context,
	selfUID string,
	chunk []uint32,
	qByHash map[uint32][]int32,
	votes map[voteKey]map[uint32]struct{},
) error {
	ph := make([]string, len(chunk))
	args := make([]any, 0, len(chunk)+1)
	for i, h := range chunk {
		ph[i] = "?"
		args = append(args, int64(h))
	}
	args = append(args, selfUID)
	// All values are bound parameters — no interpolation of caller data.
	q := `SELECT hash, unique_id, t_offset FROM audio_fingerprints
	      WHERE hash IN (` + strings.Join(ph, ",") + `) AND unique_id <> ?`

	rows, err := d.sql.QueryContext(ctx, q, args...)
	if err != nil {
		return fmt.Errorf("fingerprintdb: match query: %w", err)
	}
	defer rows.Close()

	perHash := make(map[uint32]int)
	for rows.Next() {
		var storedHash int64
		var uid string
		var toff int64
		if err := rows.Scan(&storedHash, &uid, &toff); err != nil {
			return fmt.Errorf("fingerprintdb: match scan: %w", err)
		}
		h := uint32(storedHash)
		if perHash[h]++; perHash[h] > storedFanoutCap {
			continue // noise hash: bound the work, skip its extra rows
		}
		for _, qo := range qByHash[h] {
			key := voteKey{uid: uid, delta: int(toff) - int(qo)}
			set := votes[key]
			if set == nil {
				set = make(map[uint32]struct{})
				votes[key] = set
			}
			set[h] = struct{}{}
		}
	}
	return rows.Err()
}

// finalize applies the write side of the matcher under an atomic transaction:
// always clear this upload's stale prints, then either link-on-match or
// store-if-original. The caller (Register) always holds mu.
func (d *DB) finalize(
	ctx context.Context,
	uniqueID string,
	isReel bool,
	hashes []uint32,
	offsets []int32,
	res Result,
) (Result, error) {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return res, fmt.Errorf("fingerprintdb: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM audio_fingerprints WHERE unique_id = ?`, uniqueID); err != nil {
		return res, fmt.Errorf("fingerprintdb: clear: %w", err)
	}

	if !res.Matched && !isReel {
		if err := insertPrints(ctx, tx, uniqueID, hashes, offsets); err != nil {
			// SQLITE_FULL (size cap hit) is non-fatal: matching still works,
			// we just don't grow the catalog. Surface via Stored=false.
			if isDiskFull(err) {
				if err := tx.Commit(); err != nil {
					return res, fmt.Errorf("fingerprintdb: commit(full): %w", err)
				}
				return res, nil
			}
			return res, err
		}
		res.Stored = true
	}

	if err := tx.Commit(); err != nil {
		return res, fmt.Errorf("fingerprintdb: commit: %w", err)
	}
	return res, nil
}

func insertPrints(ctx context.Context, tx *sql.Tx, uniqueID string, hashes []uint32, offsets []int32) error {
	stmt, err := tx.PrepareContext(ctx, `INSERT INTO audio_fingerprints (hash, unique_id, t_offset) VALUES (?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("fingerprintdb: prepare insert: %w", err)
	}
	defer stmt.Close()
	for i := range hashes {
		if _, err := stmt.ExecContext(ctx, int64(hashes[i]), uniqueID, int64(offsets[i])); err != nil {
			return fmt.Errorf("fingerprintdb: insert: %w", err)
		}
	}
	return nil
}

// isDiskFull matches SQLITE_FULL, raised when max_page_count (the byte cap) is
// reached. modernc phrases it "database or disk is full".
func isDiskFull(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "disk is full") || strings.Contains(msg, "(13)")
}

// DeleteFile removes all prints for a unique_id (used when a file is deleted).
func (d *DB) DeleteFile(ctx context.Context, uniqueID string) error {
	if !ValidUniqueID(uniqueID) {
		return fmt.Errorf("fingerprintdb: invalid unique_id")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	_, err := d.sql.ExecContext(ctx, `DELETE FROM audio_fingerprints WHERE unique_id = ?`, uniqueID)
	return err
}

// BulkInsert appends rows without matching — for the one-time Supabase import.
// Caller must ensure uniqueIDs are valid; invalid rows are skipped.
func (d *DB) BulkInsert(ctx context.Context, rows []Row) (int, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	stmt, err := tx.PrepareContext(ctx, `INSERT INTO audio_fingerprints (hash, unique_id, t_offset) VALUES (?, ?, ?)`)
	if err != nil {
		return 0, err
	}
	defer stmt.Close()
	n := 0
	for _, r := range rows {
		if !ValidUniqueID(r.UniqueID) {
			continue
		}
		if _, err := stmt.ExecContext(ctx, int64(r.Hash), r.UniqueID, int64(r.Offset)); err != nil {
			return n, err
		}
		n++
	}
	if err := tx.Commit(); err != nil {
		return n, err
	}
	return n, nil
}

// Row is one fingerprint for bulk import.
type Row struct {
	Hash     uint32
	UniqueID string
	Offset   int32
}
