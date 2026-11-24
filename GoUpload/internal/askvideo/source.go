package askvideo

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"goupload/lib/r2"
)

// errNotAvailable covers every reason a video can't be asked about. The caller
// gets the same answer for each, so it can't learn which rule failed.
var errNotAvailable = errors.New("askvideo: not available")

const (
	rowReadCap     = 64 << 10
	vttReadCap     = 2 << 20
	gridReadCap    = 8 << 20
	gridMetaCap    = 64 << 10
	cacheTTL       = 10 * time.Minute
	cacheMaxVideos = 32
)

var gridSlots = make(chan struct{}, 2)

var (
	captionKeyPattern = regexp.MustCompile(`^[0-9]{2}_[0-9]{2}_[0-9]{4}/([A-Za-z0-9_-]{8,64})/captions/(auto-)?[A-Za-z0-9-]{2,24}\.vtt$`)
	gridKeyPattern    = regexp.MustCompile(`^[0-9]{2}_[0-9]{2}_[0-9]{4}/([A-Za-z0-9_-]{8,64})/thumbnail_grid\.jpg$`)
	fileIDPattern     = regexp.MustCompile(`^[0-9a-fA-F-]{36}$`)
	recordIDPattern   = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	stubSongPattern   = regexp.MustCompile(`(?i)matched,\s*but musicbrainz`)
)

const (
	maxComments     = 10
	maxCommentRunes = 300
)

type video struct {
	Title         string
	Description   string
	AIDescription string
	Tags          []string
	Duration      float64
	Uploader      string
	Verified      bool
	Uploaded      time.Time
	Views         int64
	Transcript    string
	Frames        *frames
	extras
}

// extras is public detail around the video, each piece optional.
type extras struct {
	Song     *song
	SongPage *lookupResult
	Likes    int64
	Dislikes int64
	Comments []string
}

type song struct {
	Title   string
	Artists string
	Album   string
}

// media is the part read from storage, cached so follow-up questions don't
// fetch and shrink the same files again.
type media struct {
	transcript string
	frames     *frames
	extras     extras
	expires    time.Time
}

type source struct {
	baseURL    string
	serviceKey string
	r2         *r2.Client
	http       *http.Client
	search     Searcher

	mu      sync.Mutex
	cache   map[string]media
	loading map[string]*loadCall
}

// loadCall is one load of a video that everyone asking about it at the same
// moment waits on, so a crowd costs one set of reads.
type loadCall struct {
	done chan struct{}
	v    *video
	err  error
}

func newSource(baseURL, serviceKey string, client *r2.Client) *source {
	return &source{
		baseURL:    strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		serviceKey: strings.TrimSpace(serviceKey),
		r2:         client,
		http:       &http.Client{Timeout: 10 * time.Second},
		cache:      make(map[string]media),
		loading:    make(map[string]*loadCall),
	}
}

func (s *source) configured() bool {
	return s.baseURL != "" && s.serviceKey != ""
}

type fileRow struct {
	ID             string          `json:"id"`
	UniqueID       string          `json:"unique_id"`
	OwnerID        string          `json:"owner_id"`
	CreatedAt      *string         `json:"created_at"`
	Views          json.RawMessage `json:"views"`
	ViewCount      json.RawMessage `json:"view_count"`
	SongID         json.RawMessage `json:"acoustid_recording_id"`
	Comments       json.RawMessage `json:"comments_enabled"`
	Title          *string         `json:"file_title"`
	Filename       *string         `json:"filename"`
	Description    *string         `json:"file_description"`
	AIDescription  *string         `json:"ai_description"`
	Tags           json.RawMessage `json:"tags"`
	Duration       json.RawMessage `json:"duration"`
	Captions       json.RawMessage `json:"captions"`
	Thumbnails     json.RawMessage `json:"thumbnails"`
	StorageBackend *string         `json:"storage_backend"`
	StorageBucket  *string         `json:"storage_bucket"`
	Visibility     *string         `json:"visibility"`
	IsPublic       json.RawMessage `json:"is_public"`
	IsAdult        json.RawMessage `json:"is_adult"`
	Locked         json.RawMessage `json:"visibility_locked"`
	ModerationFlag *string         `json:"moderation_flag"`
	ReviewedAt     *string         `json:"moderation_reviewed_at"`
	UploadStatus   *string         `json:"upload_status"`
}

const rowSelect = "id,unique_id,owner_id,created_at,views,view_count,acoustid_recording_id,comments_enabled," +
	"file_title,filename,file_description,ai_description:metadata->>description," +
	"tags,duration,captions,thumbnails,storage_backend,storage_bucket,visibility,is_public,is_adult," +
	"visibility_locked,moderation_flag,moderation_reviewed_at,upload_status"

// load reads a video fresh for every question, so a video made private stops
// being askable right away. Callers share the result and must not change it.
func (s *source) load(ctx context.Context, uniqueID string) (*video, error) {
	if !uniqueIDPattern.MatchString(uniqueID) {
		return nil, errNotAvailable
	}
	s.mu.Lock()
	call, ok := s.loading[uniqueID]
	if !ok {
		call = &loadCall{done: make(chan struct{})}
		s.loading[uniqueID] = call
		// Not tied to the first asker, who may leave while others wait on it.
		go func() {
			defer func() {
				if p := recover(); p != nil {
					call.v, call.err = nil, fmt.Errorf("askvideo: load panic: %v", p)
				}
				s.mu.Lock()
				delete(s.loading, uniqueID)
				s.mu.Unlock()
				close(call.done)
			}()
			loadCtx, cancel := context.WithTimeout(context.Background(), loadTimeout)
			defer cancel()
			call.v, call.err = s.read(loadCtx, uniqueID)
		}()
	}
	s.mu.Unlock()
	select {
	case <-call.done:
		return call.v, call.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (s *source) read(ctx context.Context, uniqueID string) (*video, error) {
	var rows []fileRow
	q := "unique_id=eq." + url.QueryEscape(uniqueID) + "&select=" + url.QueryEscape(rowSelect) + "&limit=2"
	if err := s.rest(ctx, "files", q, &rows); err != nil {
		return nil, err
	}
	// Two rows with one unique id means something is off; don't guess which.
	if len(rows) != 1 || rows[0].UniqueID != uniqueID || !askable(rows[0]) {
		return nil, errNotAvailable
	}
	row := rows[0]
	owner, err := s.checkOwner(ctx, row.OwnerID)
	if err != nil {
		return nil, err
	}

	v := &video{
		Title:         firstNonEmpty(row.Title, row.Filename),
		Description:   deref(row.Description),
		AIDescription: deref(row.AIDescription),
		Tags:          stringList(row.Tags),
		Duration:      number(row.Duration),
		Uploader:      owner.username,
		Verified:      owner.verified,
		Views:         int64(max(number(row.Views), number(row.ViewCount))),
	}
	if t, err := time.Parse(time.RFC3339Nano, deref(row.CreatedAt)); err == nil {
		v.Uploaded = t
	}
	m := s.media(ctx, row)
	v.Transcript = m.transcript
	v.Frames = m.frames
	v.extras = m.extras
	return v, nil
}

// askable is the whole rule: public to everyone, not 18+, not held by
// moderation, finished processing. Anything unexpected counts as a no.
func askable(r fileRow) bool {
	if r.Visibility == nil || *r.Visibility != "public" {
		return false
	}
	if public, ok := boolField(r.IsPublic); !ok || !public {
		return false
	}
	if adult, ok := boolField(r.IsAdult); !ok || adult {
		return false
	}
	if locked, ok := boolField(r.Locked); !ok || locked {
		return false
	}
	// The lock is what holds a file. An adult flag left on a public, unlocked,
	// non 18+ file is an old classifier guess the site already shows to
	// everyone, but any other flag stays off limits until a human clears it.
	if flag := deref(r.ModerationFlag); flag != "" && flag != "adult" && deref(r.ReviewedAt) == "" {
		return false
	}
	status := strings.ToLower(strings.TrimSpace(deref(r.UploadStatus)))
	return status == "complete" || status == "completed"
}

type owner struct {
	username string
	verified bool
}

// checkOwner withholds videos from restricted or terminated accounts, the same
// way the watch page does for everyone but the owner.
func (s *source) checkOwner(ctx context.Context, ownerID string) (owner, error) {
	if !userIDPattern.MatchString(ownerID) {
		return owner{}, errNotAvailable
	}
	var users []struct {
		Username  *string         `json:"username"`
		Verified  json.RawMessage `json:"verified"`
		Status    *string         `json:"account_status"`
		ExpiresAt *string         `json:"status_expires_at"`
	}
	q := "id=eq." + url.QueryEscape(ownerID) + "&select=username,verified,account_status,status_expires_at&limit=1"
	if err := s.rest(ctx, "users", q, &users); err != nil {
		return owner{}, err
	}
	if len(users) != 1 {
		return owner{}, errNotAvailable
	}
	u := users[0]
	verified, _ := boolField(u.Verified)
	o := owner{username: deref(u.Username), verified: verified}
	switch strings.ToLower(strings.TrimSpace(deref(u.Status))) {
	case "", "active", "strike":
		return o, nil
	case "restricted":
		if exp := deref(u.ExpiresAt); exp != "" {
			if t, err := time.Parse(time.RFC3339Nano, exp); err == nil && !t.After(time.Now()) {
				return o, nil
			}
		}
		return owner{}, errNotAvailable
	default:
		return owner{}, errNotAvailable
	}
}

func (s *source) rest(ctx context.Context, table, query string, out any) error {
	return s.do(ctx, http.MethodGet, "/rest/v1/"+table+"?"+query, nil, out)
}

func (s *source) do(ctx context.Context, method, path string, body []byte, out any) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, s.baseURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("apikey", s.serviceKey)
	req.Header.Set("Authorization", "Bearer "+s.serviceKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, rowReadCap+1))
	if err != nil {
		return err
	}
	name, _, _ := strings.Cut(path, "?")
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("supabase %s status %d", name, res.StatusCode)
	}
	if len(data) > rowReadCap {
		return fmt.Errorf("supabase %s response too large", name)
	}
	return json.Unmarshal(data, out)
}

func (s *source) media(ctx context.Context, row fileRow) media {
	now := time.Now()
	s.mu.Lock()
	if m, ok := s.cache[row.UniqueID]; ok && now.Before(m.expires) {
		s.mu.Unlock()
		return m
	}
	s.mu.Unlock()

	// Everything here is optional: a video still has its title and description,
	// so a hiccup in one source makes the answer thinner instead of failing it.
	m := media{expires: now.Add(cacheTTL)}
	var wg sync.WaitGroup
	run := func(f func()) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() {
				if p := recover(); p != nil {
					log.Printf("askvideo: reading part of video %s panicked: %v", row.UniqueID, p)
				}
			}()
			f()
		}()
	}
	if s.r2 != nil {
		run(func() { m.transcript = s.transcript(ctx, row) })
		run(func() { m.frames = s.frames(ctx, row) })
	}
	run(func() {
		m.extras.Song = s.song(ctx, row)
		m.extras.SongPage = songPage(ctx, s.search, m.extras.Song)
	})
	run(func() { m.extras.Likes, m.extras.Dislikes = s.likes(ctx, row) })
	run(func() { m.extras.Comments = s.comments(ctx, row) })
	wg.Wait()

	s.mu.Lock()
	defer s.mu.Unlock()
	for k, e := range s.cache {
		if !now.Before(e.expires) {
			delete(s.cache, k)
		}
	}
	if len(s.cache) >= cacheMaxVideos {
		var oldest string
		for k, e := range s.cache {
			if oldest == "" || e.expires.Before(s.cache[oldest].expires) {
				oldest = k
			}
		}
		delete(s.cache, oldest)
	}
	s.cache[row.UniqueID] = m
	return m
}

type captionEntry struct {
	Language string `json:"language"`
	Path     string `json:"path"`
	Auto     bool   `json:"auto"`
}

func (s *source) transcript(ctx context.Context, row fileRow) string {
	key := pickCaption(row.UniqueID, captionEntries(row.Captions))
	if key == "" {
		return ""
	}
	data, err := s.r2.GetObject(ctx, key, vttReadCap)
	if err != nil {
		return ""
	}
	return vttToTranscript(data, maxTranscriptChars)
}

// pickCaption prefers captions the owner wrote over speech recognition, and
// English over other languages, since the model answers best from those.
func pickCaption(uniqueID string, entries []captionEntry) string {
	best, bestScore := "", -1
	for _, e := range entries {
		m := captionKeyPattern.FindStringSubmatch(e.Path)
		if m == nil || m[1] != uniqueID {
			continue
		}
		score := 0
		if !e.Auto {
			score += 2
		}
		if lang := strings.ToLower(e.Language); lang == "en" || strings.HasPrefix(lang, "en-") {
			score++
		}
		if score > bestScore {
			best, bestScore = e.Path, score
		}
	}
	return best
}

func captionEntries(raw json.RawMessage) []captionEntry {
	raw = unwrapJSONString(raw)
	var entries []captionEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil
	}
	return entries
}

func (s *source) frames(ctx context.Context, row fileRow) *frames {
	if deref(row.StorageBackend) != "r2" {
		return nil
	}
	if b := deref(row.StorageBucket); b != "" && b != s.r2.Bucket() {
		return nil
	}
	var key string
	for _, p := range stringList(row.Thumbnails) {
		if m := gridKeyPattern.FindStringSubmatch(p); m != nil && m[1] == row.UniqueID {
			key = p
			break
		}
	}
	if key == "" {
		return nil
	}
	// A long video's grid decodes to tens of megabytes, so only a couple at once.
	select {
	case gridSlots <- struct{}{}:
		defer func() { <-gridSlots }()
	case <-ctx.Done():
		return nil
	}
	jpg, err := s.r2.GetObject(ctx, key, gridReadCap)
	if err != nil {
		return nil
	}
	var cells []gridCell
	if meta, err := s.r2.GetObject(ctx, strings.TrimSuffix(key, ".jpg")+".json", gridMetaCap); err == nil {
		cells = gridCells(meta)
	}
	f, err := shrinkGrid(jpg, cells)
	if err != nil {
		return nil
	}
	return f
}

func (s *source) song(ctx context.Context, row fileRow) *song {
	id := idString(row.SongID)
	if !recordIDPattern.MatchString(id) {
		return nil
	}
	var recs []struct {
		Title   *string `json:"title"`
		Artists *string `json:"artists"`
		Album   *string `json:"album"`
	}
	if s.rest(ctx, "acoustid_recordings", "id=eq."+url.QueryEscape(id)+"&select=title,artists,album&limit=1", &recs) != nil || len(recs) != 1 {
		return nil
	}
	sg := &song{Title: deref(recs[0].Title), Artists: deref(recs[0].Artists), Album: deref(recs[0].Album)}
	// Fingerprint matches without real song details; the watch page hides these too.
	if sg.Title == "" || sg.Artists == "" || strings.EqualFold(sg.Title, "unknown title") ||
		strings.EqualFold(sg.Artists, "unknown artist") || stubSongPattern.MatchString(sg.Title) {
		return nil
	}
	return sg
}

func (s *source) likes(ctx context.Context, row fileRow) (likes, dislikes int64) {
	if !fileIDPattern.MatchString(row.ID) {
		return 0, 0
	}
	body, _ := json.Marshal(map[string]any{"p_file_id": row.ID, "p_user_id": nil})
	var raw json.RawMessage
	if s.do(ctx, http.MethodPost, "/rest/v1/rpc/get_file_interactions", body, &raw) != nil {
		return 0, 0
	}
	var list []json.RawMessage
	if json.Unmarshal(raw, &list) == nil {
		if len(list) == 0 {
			return 0, 0
		}
		raw = list[0]
	}
	var counts struct {
		Likes    json.RawMessage `json:"like_count"`
		Dislikes json.RawMessage `json:"dislike_count"`
	}
	if json.Unmarshal(raw, &counts) != nil {
		return 0, 0
	}
	return int64(number(counts.Likes)), int64(number(counts.Dislikes))
}

// comments are the newest top level comments anyone can see on the page.
// Only the text is read, never who wrote it.
func (s *source) comments(ctx context.Context, row fileRow) []string {
	if !fileIDPattern.MatchString(row.ID) {
		return nil
	}
	// Owners can turn comments off; null is the default, on.
	if raw := strings.TrimSpace(string(row.Comments)); raw != "" && raw != "null" {
		if enabled, ok := boolField(row.Comments); !ok || !enabled {
			return nil
		}
	}
	var rows []struct {
		Content *string `json:"content"`
	}
	q := "file_id=eq." + url.QueryEscape(row.ID) + "&parent_id=is.null&is_deleted=eq.false&is_hidden=not.is.true" +
		"&select=content&order=created_at.desc&limit=" + strconv.Itoa(maxComments*2)
	if s.rest(ctx, "comments", q, &rows) != nil {
		return nil
	}
	out := make([]string, 0, maxComments)
	for _, r := range rows {
		text := strings.Join(strings.Fields(deref(r.Content)), " ")
		if text == "" {
			continue
		}
		out = append(out, truncateRunes(text, maxCommentRunes))
		if len(out) == maxComments {
			break
		}
	}
	return out
}

// gridCells reads thumbnail_grid.json. Older grids only list times; their
// cells come back without a rect and the grid is then shrunk whole.
func gridCells(meta []byte) []gridCell {
	var m struct {
		Cells []struct {
			X          int     `json:"x"`
			Y          int     `json:"y"`
			W          int     `json:"w"`
			H          int     `json:"h"`
			TimeOffset float64 `json:"timeOffset"`
		} `json:"cells"`
	}
	if json.Unmarshal(meta, &m) != nil || len(m.Cells) > maxFrames {
		return nil
	}
	out := make([]gridCell, 0, len(m.Cells))
	for _, c := range m.Cells {
		out = append(out, gridCell{X: c.X, Y: c.Y, W: c.W, H: c.H, Time: c.TimeOffset})
	}
	return out
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return strings.TrimSpace(*s)
}

func firstNonEmpty(values ...*string) string {
	for _, v := range values {
		if s := deref(v); s != "" {
			return s
		}
	}
	return ""
}

// boolField reads a boolean column that older rows may hold as 0/1 or text.
// null reads as false, matching the app; anything unreadable is not ok.
func boolField(raw json.RawMessage) (value, ok bool) {
	s := strings.TrimSpace(string(raw))
	switch strings.ToLower(strings.Trim(s, `"`)) {
	case "", "null":
		return false, true
	case "true", "t", "1":
		return true, true
	case "false", "f", "0":
		return false, true
	}
	return false, false
}

func number(raw json.RawMessage) float64 {
	raw = unwrapJSONString(raw)
	f, err := strconv.ParseFloat(strings.TrimSpace(string(raw)), 64)
	if err != nil || f < 0 || f > 1e7 {
		return 0
	}
	return f
}

// stringList reads a text[] or jsonb array of strings, skipping anything else.
func stringList(raw json.RawMessage) []string {
	raw = unwrapJSONString(raw)
	var items []json.RawMessage
	if json.Unmarshal(raw, &items) != nil {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, it := range items {
		var s string
		if json.Unmarshal(it, &s) == nil {
			if s = strings.TrimSpace(s); s != "" {
				out = append(out, s)
			}
		}
	}
	return out
}

// idString reads an id column that may hold text or a number.
func idString(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return strings.TrimSpace(s)
	}
	var n json.Number
	if json.Unmarshal(raw, &n) == nil {
		return n.String()
	}
	return ""
}

// unwrapJSONString handles jsonb that was stored as a JSON string holding JSON.
func unwrapJSONString(raw json.RawMessage) json.RawMessage {
	var inner string
	if json.Unmarshal(raw, &inner) == nil {
		return json.RawMessage(inner)
	}
	return raw
}
