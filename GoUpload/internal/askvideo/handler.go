// Package askvideo answers a viewer's questions about one video with Qwen on
// Groq. Only the app server calls it (X-Webhook-Secret), after checking the
// viewer's session. The rule about which videos can be asked about lives here,
// so even a forged call can't reach a private, unlisted, adult or flagged one.
//
// The model only ever reads text and writes text. It has no way to change
// anything: the lookups below are fixed reads that this code runs for it.
package askvideo

import (
	"bufio"
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"goupload/lib/logger"
	"goupload/lib/r2"
	"goupload/lib/usercap"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/limiter"
)

const (
	maxBodyBytes     = 16 << 10
	maxAsksAtOnce    = 2
	maxQuestionRunes = 500
	loadTimeout      = 25 * time.Second
	answerTimeout    = 60 * time.Second
	saveTimeout      = 5 * time.Second
)

var (
	// Newer uploads use 32 hex characters; older ones use around 20 letters and digits.
	uniqueIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)
	userIDPattern   = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
)

// Ask's daily share of a free Groq key is only about 20 new questions, so one
// account can't take everyone's.
var askCaps = []usercap.Window{
	{Name: "ask_hour", Limit: 10, Per: time.Hour},
	{Name: "ask_day", Limit: 25, Per: 24 * time.Hour},
}

// Wikipedia is free, but it's someone else's server.
var lookupCaps = []usercap.Window{
	{Name: "ask_lookup_day", Limit: 40, Per: 24 * time.Hour},
}

type Config struct {
	SupabaseURL   string
	SupabaseKey   string
	R2            *r2.Client
	WebhookSecret string
	Model         Model
	Caps          *usercap.Limiter
	// Search is optional; without it the model just isn't offered lookups.
	Search Searcher
	// Conversations falls back to process memory, which suits tests and local
	// runs. Production passes the Redis store.
	Conversations ConversationStore
}

type turn struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type askBody struct {
	UniqueID       string `json:"uniqueId"`
	UserID         string `json:"userId"`
	Question       string `json:"question"`
	ConversationID string `json:"conversationId"`
}

// event is one line of the answer stream: "c" names the chat, "w" says how
// many seconds it waits in line, "s" and "r" report a lookup and its sources,
// "d" carries text, then "done" or "err" ("busy" with seconds to retry).
type event struct {
	T       string       `json:"t"`
	V       string       `json:"v,omitempty"`
	N       int          `json:"n,omitempty"`
	Sources []sourceLink `json:"sources,omitempty"`
}

type sourceLink struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

func RegisterRoutes(app *fiber.App, log *logger.Logger, cfg Config) {
	if cfg.Model == nil && log != nil {
		log.Infof("ask: GROQ_API_KEYS not set, /internal/ask will answer 503")
	}
	src := newSource(cfg.SupabaseURL, cfg.SupabaseKey, cfg.R2)
	src.search = cfg.Search
	chats := cfg.Conversations
	if chats == nil {
		chats = newMemoryConversations()
	}
	shared := newSharedAnswers()
	asking := newUserSlots(maxAsksAtOnce, loadTimeout+answerTimeout)

	// Ask shares a process with uploads, so a bug here must never take it down.
	// Errors are logged and answered with a fixed reply: Fiber's default error
	// handler would send err.Error(), panic text included.
	app.Use("/internal/ask", func(c *fiber.Ctx) (err error) {
		defer func() {
			if p := recover(); p != nil {
				if log != nil {
					log.Errorf("ask: panic: %v", p)
				}
				err = c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "unavailable"})
			}
		}()
		if err = c.Next(); err == nil {
			return nil
		}
		code := fiber.StatusInternalServerError
		if fe := (*fiber.Error)(nil); errors.As(err, &fe) {
			code = fe.Code
		} else if log != nil {
			log.Errorf("ask: %s", err.Error())
		}
		return c.Status(code).JSON(fiber.Map{"error": "unavailable"})
	})
	// Stops scanners. Every real question comes from the app server's one
	// address, so calls with the secret skip it; the per viewer caps and the
	// model's line are what hold those back.
	app.Use("/internal/ask", limiter.New(limiter.Config{
		Max:        120,
		Expiration: time.Minute,
		Next: func(c *fiber.Ctx) bool {
			return hasSecret(c, cfg.WebhookSecret)
		},
		KeyGenerator: func(c *fiber.Ctx) string {
			return "ip:" + c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			c.Set("Retry-After", "60")
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{"error": "rate_limited"})
		},
	}))

	app.Post("/internal/ask", func(c *fiber.Ctx) error {
		if cfg.WebhookSecret == "" {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "unavailable"})
		}
		if !hasSecret(c, cfg.WebhookSecret) {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
		}
		if cfg.Model == nil || cfg.Caps == nil || !src.configured() {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "unavailable"})
		}
		if len(c.Body()) > maxBodyBytes {
			return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{"error": "invalid_request"})
		}

		body, ok := parseBody(c.Body())
		if !ok {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid_request"})
		}
		key := sharedKey(body.UniqueID, body.Question)
		// Turned away before the viewer's quota is charged. An answer someone
		// already got costs the model nothing, so that one never is.
		if q, ok := cfg.Model.(interface{ crowded() time.Duration }); ok && (body.ConversationID != "" || !shared.has(key)) {
			if wait := q.crowded(); wait > maxQueueWait {
				return busy(c, wait)
			}
		}
		if !asking.take(body.UserID) {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{"error": "too_fast"})
		}
		held := true
		defer func() {
			if held {
				asking.give(body.UserID)
			}
		}()
		if !cfg.Caps.Allow(c, body.UserID, "ask_limit", askCaps...) {
			return nil
		}

		ctx, cancel := context.WithTimeout(c.UserContext(), loadTimeout)
		defer cancel()

		v, err := src.load(ctx, body.UniqueID)
		if errors.Is(err, errNotAvailable) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not_available"})
		}
		if err != nil {
			if log != nil {
				log.Errorf("ask: load video=%s err=%s", body.UniqueID, err.Error())
			}
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "unavailable"})
		}

		chatID, chat := openChat(ctx, chats, body)
		if chatID == "" {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "unavailable"})
		}
		if len(chat.Turns) > 0 || chat.Summary != "" {
			key = ""
		}
		fingerprint := videoFingerprint(v)
		fold(ctx, cfg.Model, chat)

		turns, summary := chat.Turns, chat.Summary
		build := func(lean bool) []message {
			return buildMessages(v, summary, turns, body.Question, cfg.Search != nil, lean)
		}
		question, userID := body.Question, body.UserID
		c.Set(fiber.HeaderContentType, "application/x-ndjson; charset=utf-8")
		c.Set(fiber.HeaderCacheControl, "no-store, no-transform")
		c.Set("X-Accel-Buffering", "no")
		held = false
		// Runs after the handler returns, in a goroutine of its own, so it must
		// not touch c, and a panic here would end the whole process if the
		// recover below didn't catch it.
		c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
			defer asking.give(userID)
			ctx, cancel := context.WithTimeout(context.Background(), answerTimeout)
			defer cancel()
			gone, sourced := false, false
			send := func(ev event) error {
				if gone {
					return errViewerLeft
				}
				sourced = sourced || ev.T == "r"
				line, _ := json.Marshal(ev)
				if _, err := w.Write(append(line, '\n')); err != nil {
					gone = true
					return err
				}
				if err := w.Flush(); err != nil {
					gone = true
					return err
				}
				return nil
			}
			defer func() {
				if p := recover(); p != nil {
					if log != nil {
						log.Errorf("ask: panic video=%s: %v", body.UniqueID, p)
					}
					_ = send(event{T: "err"})
				}
			}()

			var text string
			err := send(event{T: "c", V: chatID})
			if err == nil {
				ask := func(send func(event) error) (string, error) {
					text, err := answer(ctx, cfg, log, userID, build, send)
					if p := v.SongPage; err == nil && p != nil && !sourced && strings.Contains(strings.ToLower(text), "wikipedia") {
						err = send(event{T: "r", Sources: []sourceLink{{Title: p.Title, URL: p.URL}}})
					}
					return text, err
				}
				text, err = respondShared(ctx, shared, key, fingerprint, send, ask)
			}
			wait, isBusy := busyFor(err)
			switch {
			case gone:
			case isBusy:
				if b := (*busyError)(nil); errors.As(err, &b) && b.cause != nil && log != nil {
					log.Infof("ask: groq turned it away video=%s err=%s", body.UniqueID, err.Error())
				}
				_ = send(event{T: "err", V: "busy", N: seconds(wait)})
			case err != nil:
				if log != nil {
					log.Errorf("ask: model video=%s err=%s", body.UniqueID, err.Error())
				}
				_ = send(event{T: "err"})
			default:
				_ = send(event{T: "done"})
			}

			// Remember what the viewer saw, even an answer cut short.
			if text = strings.TrimSpace(text); text != "" {
				chat.Turns = append(chat.Turns,
					turn{Role: "user", Content: question},
					turn{Role: "assistant", Content: truncateRunes(text, maxStoredAnswer)})
				saveCtx, cancelSave := context.WithTimeout(context.Background(), saveTimeout)
				if err := chats.Save(saveCtx, chatID, chat); err != nil && log != nil {
					log.Errorf("ask: save chat err=%s", err.Error())
				}
				cancelSave()
			}
		})
		return nil
	})
}

var errViewerLeft = errors.New("askvideo: viewer left")

func hasSecret(c *fiber.Ctx, secret string) bool {
	return secret != "" && subtle.ConstantTimeCompare([]byte(c.Get("X-Webhook-Secret")), []byte(secret)) == 1
}

// respondShared answers a chat's first question once for everyone asking it.
// The first asker writes the answer, and it keeps going after they leave as
// long as others follow. A follower whose leader failed before any text tries
// again, which may make it the new leader.
func respondShared(ctx context.Context, shared *sharedAnswers, key, fingerprint string, send func(event) error, ask func(func(event) error) (string, error)) (string, error) {
	if key == "" {
		return ask(send)
	}
	for try := 0; try < 2; try++ {
		b, lead := shared.join(key, fingerprint)
		if lead {
			text, err := ask(func(ev event) error {
				b.add(ev)
				if err := send(ev); err != nil && !b.watched() {
					return err
				}
				return nil
			})
			shared.finish(key, b, err == nil && strings.TrimSpace(text) != "")
			return text, err
		}
		var got strings.Builder
		ok, err := b.follow(ctx, func(ev event) error {
			if ev.T == "w" {
				return nil
			}
			if ev.T == "d" {
				got.WriteString(ev.V)
			}
			return send(ev)
		})
		if err != nil || ok || got.Len() > 0 {
			if err == nil && !ok {
				err = errors.New("askvideo: shared answer failed")
			}
			return got.String(), err
		}
	}
	return ask(send)
}

func busy(c *fiber.Ctx, wait time.Duration) error {
	secs := seconds(wait)
	c.Set("Retry-After", strconv.Itoa(secs))
	return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "busy", "retry_after": secs})
}

// seconds rounds a wait up for people, within what a client will show.
func seconds(d time.Duration) int {
	return min(max(int((d+time.Second-1)/time.Second), 1), 120)
}

// userSlots lets each viewer have a few questions going at once. A slot frees
// itself after hold, so one a lost connection never gave back can't stick.
type userSlots struct {
	mu    sync.Mutex
	limit int
	hold  time.Duration
	held  map[string][]time.Time
}

func newUserSlots(limit int, hold time.Duration) *userSlots {
	return &userSlots{limit: limit, hold: hold, held: map[string][]time.Time{}}
}

func (u *userSlots) take(user string) bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	now := time.Now()
	var live []time.Time
	for _, until := range u.held[user] {
		if now.Before(until) {
			live = append(live, until)
		}
	}
	if len(live) >= u.limit {
		u.held[user] = live
		return false
	}
	u.held[user] = append(live, now.Add(u.hold))
	return true
}

func (u *userSlots) give(user string) {
	u.mu.Lock()
	defer u.mu.Unlock()
	if h := u.held[user]; len(h) > 1 {
		u.held[user] = h[1:]
	} else {
		delete(u.held, user)
	}
}

// openChat continues the viewer's chat about this video, or starts a new one
// when there is none, it expired, or it belongs to someone else.
func openChat(ctx context.Context, chats ConversationStore, body askBody) (string, *conversation) {
	if body.ConversationID != "" {
		c, err := chats.Load(ctx, body.ConversationID)
		if err == nil && c != nil && c.UserID == body.UserID && c.UniqueID == body.UniqueID {
			return body.ConversationID, c
		}
	}
	id, err := newConversationID()
	if err != nil {
		return "", nil
	}
	return id, &conversation{UserID: body.UserID, UniqueID: body.UniqueID}
}

// answer streams the reply. If the model asks for a lookup, this code runs
// it, within the viewer's cap, and the model answers again with the results.
func answer(ctx context.Context, cfg Config, log *logger.Logger, userID string, build func(lean bool) []message, send func(event) error) (string, error) {
	var text strings.Builder
	emit := func(s string) error {
		text.WriteString(s)
		return send(event{T: "d", V: s})
	}
	msgs := build(false)
	req := chatRequest{Messages: msgs, MaxTokens: maxAnswerTokens, OnWait: func(d time.Duration) {
		_ = send(event{T: "w", N: seconds(d)})
	}}
	// Only the stream that ends the answer decides whether it was cut short.
	cut := false
	req.OnCut = func() { cut = true }
	sayIfCut := func() {
		if cut {
			_ = send(event{T: "cut"})
		}
	}
	if cfg.Search != nil {
		req.Tools = []tool{lookupTool}
	}
	calls, err := cfg.Model.Stream(ctx, req, emit)
	if errors.Is(err, errTooLarge) && text.Len() == 0 {
		if log != nil {
			log.Infof("ask: request too large, retrying without the frames")
		}
		msgs = build(true)
		req.Messages = msgs
		calls, err = cfg.Model.Stream(ctx, req, emit)
	}
	if err != nil || len(calls) == 0 {
		if err == nil {
			sayIfCut()
		}
		return text.String(), err
	}

	result := "The lookup isn't available right now. Answer from the video information and general knowledge you're confident about."
	if q := lookupQuery(calls[0]); q != "" && cfg.Search != nil {
		if ok, _, capErr := cfg.Caps.Take(ctx, userID, lookupCaps...); capErr == nil && ok {
			if err := send(event{T: "s", V: q}); err != nil {
				return text.String(), err
			}
			found, lookErr := cfg.Search.Search(ctx, q)
			switch {
			case lookErr != nil:
				if log != nil {
					log.Errorf("ask: lookup err=%s", lookErr.Error())
				}
			default:
				result = lookupText(q, found)
				if len(found) > 0 {
					srcs := make([]sourceLink, len(found))
					for i, r := range found {
						srcs[i] = sourceLink{Title: r.Title, URL: r.URL}
					}
					if err := send(event{T: "r", Sources: srcs}); err != nil {
						return text.String(), err
					}
				}
			}
		}
	}

	var said any
	if s := strings.TrimSpace(text.String()); s != "" {
		said = s
	}
	followUp := append(append([]message(nil), msgs...), message{Role: "assistant", Content: said, ToolCalls: calls})
	for i, call := range calls {
		reply := "Only one lookup is allowed per question."
		if i == 0 {
			reply = result
		}
		followUp = append(followUp, message{Role: "tool", ToolCallID: call.ID, Content: reply})
	}
	if text.Len() > 0 {
		if err := emit("\n\n"); err != nil {
			return text.String(), err
		}
	}
	before := text.Len()
	req.Messages, req.NoTools = followUp, true
	cut = false
	if _, err := cfg.Model.Stream(ctx, req, emit); err != nil {
		return text.String(), err
	}
	if text.Len() == before {
		return text.String(), errors.New("askvideo: no answer after lookup")
	}
	sayIfCut()
	return text.String(), nil
}

func parseBody(raw []byte) (askBody, bool) {
	var body askBody
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		return askBody{}, false
	}
	if !uniqueIDPattern.MatchString(body.UniqueID) || !userIDPattern.MatchString(body.UserID) {
		return askBody{}, false
	}
	if body.ConversationID != "" && !conversationIDPattern.MatchString(body.ConversationID) {
		return askBody{}, false
	}
	body.Question = strings.TrimSpace(body.Question)
	if !validText(body.Question, maxQuestionRunes) {
		return askBody{}, false
	}
	return body, true
}

func validText(s string, maxRunes int) bool {
	if s == "" || !utf8.ValidString(s) {
		return false
	}
	return utf8.RuneCountInString(s) <= maxRunes
}
