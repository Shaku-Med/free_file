package askvideo

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	groqEndpoint = "https://api.groq.com/openai/v1/chat/completions"
	DefaultModel = "qwen/qwen3.8-27b"
	replyReadCap = 256 << 10
	maxAttempts  = 3
	// A 429 sends the request back in line for another key, this many times
	// at most before the viewer is told to try again shortly.
	maxRateLimits = 8
	maxToolCalls  = 4
	maxToolArgLen = 2 << 10
)

// Model streams a reply, calling emit with each new piece of visible text.
// When the request offers tools the model may ask for them instead; those
// calls come back once the stream ends.
type Model interface {
	Stream(ctx context.Context, req chatRequest, emit func(string) error) ([]toolCall, error)
}

type chatRequest struct {
	Messages  []message
	MaxTokens int
	Tools     []tool
	// NoTools keeps the tools listed, which a chat holding tool results needs,
	// but stops the model from calling them again.
	NoTools bool
	// OnWait hears how long the request expects to wait in line for a key.
	OnWait func(time.Duration)
	// OnCut hears that the answer ran out of room before the model finished.
	OnCut func()
}

type imageURL struct {
	URL string `json:"url"`
}

type part struct {
	Type     string    `json:"type"`
	Text     string    `json:"text,omitempty"`
	ImageURL *imageURL `json:"image_url,omitempty"`
}

// message content is a plain string, text plus an image as []part, or nil on
// an assistant turn that only calls tools.
type message struct {
	Role       string     `json:"role"`
	Content    any        `json:"content"`
	ToolCalls  []toolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

type toolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"`
	Function toolFunction `json:"function"`
}

type toolFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type tool struct {
	Type     string  `json:"type"`
	Function toolDef `json:"function"`
}

type toolDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

type Groq struct {
	model    string
	endpoint string
	http     *http.Client
	sched    *scheduler
}

// NewGroq returns nil when there are no keys, which turns the feature off
// instead of letting it run without a key.
func NewGroq(keysCSV, model string) *Groq {
	var keys []string
	for _, k := range strings.Split(keysCSV, ",") {
		if k = strings.TrimSpace(k); k != "" {
			keys = append(keys, k)
		}
	}
	if len(keys) == 0 {
		return nil
	}
	if model = strings.TrimSpace(model); model == "" {
		model = DefaultModel
	}
	return &Groq{
		model:    model,
		endpoint: groqEndpoint,
		http:     &http.Client{Timeout: 45 * time.Second},
		sched:    newScheduler(keys, keyInPerMin, keyOutPerMin, keyAskPerDay),
	}
}

// retryable errors may succeed on another key. limited marks a 429, and wait
// is how long Groq asked us to back off, when it said.
type retryable struct {
	error
	limited bool
	wait    time.Duration
}

// crowded is how long a new question would wait for a key.
func (g *Groq) crowded() time.Duration { return g.sched.crowded() }

func (g *Groq) Stream(ctx context.Context, req chatRequest, emit func(string) error) ([]toolCall, error) {
	body := map[string]any{
		"model":       g.model,
		"messages":    req.Messages,
		"max_tokens":  req.MaxTokens,
		"temperature": 0.4,
		"stream":      true,
		// Left on, the model sometimes reasons in the open and its notes, which
		// can quote the rules, stream straight to the viewer.
		"reasoning_effort": "none",
		"reasoning_format": "hidden",
	}
	if len(req.Tools) > 0 {
		body["tools"] = req.Tools
		body["tool_choice"] = "auto"
		if req.NoTools {
			body["tool_choice"] = "none"
		}
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	in, out := float64(requestTokens(req)), float64(req.MaxTokens)
	// Only the opening request is retried. Once text has reached the viewer a
	// second attempt would repeat it.
	var (
		res              *http.Response
		key              *keyState
		left             float64
		failures, limits int
		start            = time.Now()
	)
	for {
		if key, err = g.sched.acquire(ctx, in, out, req.OnWait); err != nil {
			return nil, err
		}
		if res, left, err = g.open(ctx, key.key, payload); err == nil {
			break
		}
		// Refused, so it never counted against the key.
		g.sched.settle(key, in, out)
		var r retryable
		switch {
		case errors.As(err, &r) && r.limited:
			// Something else is spending this key too, or Groq counts more
			// than we guessed; its own numbers say how long to leave it.
			g.sched.observe(key, left)
			g.sched.limited(key, r.wait)
			if limits++; limits >= maxRateLimits || time.Since(start) >= maxQueueWait {
				return nil, &busyError{retry: max(r.wait, g.sched.crowded(), minBusyRetry), cause: err}
			}
		case errors.As(err, &r):
			g.sched.failed(key)
			if failures++; failures >= maxAttempts {
				return nil, err
			}
		default:
			return nil, err
		}
		if ctx.Err() != nil {
			return nil, err
		}
	}
	defer res.Body.Close()
	g.sched.observe(key, left)
	g.sched.worked(key)
	spent := 0.0
	calls, cut, err := readStream(io.LimitReader(res.Body, replyReadCap), func(s string) error {
		spent += float64(estimateTokens(s))
		return emit(s)
	})
	for _, c := range calls {
		spent += float64(estimateTokens(c.Function.Name+c.Function.Arguments) + 8)
	}
	g.sched.settle(key, 0, out-spent)
	if cut && err == nil && req.OnCut != nil {
		req.OnCut()
	}
	return calls, err
}

// open starts a request on key. left is what Groq says the key has left this
// minute, or -1 when it didn't say.
func (g *Groq) open(ctx context.Context, key string, payload []byte) (res *http.Response, left float64, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, -1, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Authorization", "Bearer "+key)
	if res, err = g.http.Do(req); err != nil {
		return nil, -1, retryable{error: err}
	}
	left = tokensLeft(res.Header)
	if res.StatusCode == http.StatusOK {
		return res, left, nil
	}
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 16<<10))
	res.Body.Close()
	if res.StatusCode == http.StatusTooManyRequests || res.StatusCode >= 500 {
		r := retryable{error: fmt.Errorf("groq status %d%s", res.StatusCode, limitName(raw)), limited: res.StatusCode == http.StatusTooManyRequests}
		if s, err := strconv.ParseFloat(strings.TrimSpace(res.Header.Get("Retry-After")), 64); err == nil && s > 0 && s < 3600 {
			r.wait = time.Duration(s * float64(time.Second))
		}
		return nil, left, r
	}
	if res.StatusCode == http.StatusRequestEntityTooLarge {
		return nil, left, errTooLarge
	}
	return nil, left, fmt.Errorf("groq status %d", res.StatusCode)
}

func tokensLeft(h http.Header) float64 {
	n, err := strconv.ParseFloat(strings.TrimSpace(h.Get("X-Ratelimit-Remaining-Tokens")), 64)
	if err != nil || n < 0 || n > 1e9 {
		return -1
	}
	return n
}

var limitPattern = regexp.MustCompile(`per (?:minute|day) \(([A-Z]{2,5})\)`)

// limitName picks which limit a 429 hit, like OTPM, out of Groq's message,
// which also names the account, so nothing else of it is kept.
func limitName(body []byte) string {
	if m := limitPattern.FindSubmatch(body); m != nil {
		return " " + string(m[1])
	}
	return ""
}

// errTooLarge means the request is over the per minute token limit by itself,
// so no key or wait will take it; only a smaller request will.
var errTooLarge = errors.New("groq: request too large")

// complete runs a reply to the end and returns its text, for short internal
// jobs like folding old messages into a summary.
func complete(ctx context.Context, m Model, msgs []message, maxTokens int) (string, error) {
	var out strings.Builder
	_, err := m.Stream(ctx, chatRequest{Messages: msgs, MaxTokens: maxTokens}, func(s string) error {
		out.WriteString(s)
		return nil
	})
	return strings.TrimSpace(out.String()), err
}

// readStream reads OpenAI style server sent events and passes on only the
// text a viewer should see. Tool calls arrive in pieces and are put together.
// cut means the answer hit max_tokens or the length cap before it ended.
func readStream(r io.Reader, emit func(string) error) (_ []toolCall, cut bool, _ error) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 16<<10), 256<<10)
	var out answerFilter
	calls := map[int]*toolCall{}
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		data, ok := strings.CutPrefix(line, "data:")
		if !ok {
			continue
		}
		data = strings.TrimSpace(data)
		if data == "[DONE]" {
			break
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content   string `json:"content"`
					ToolCalls []struct {
						Index    int          `json:"index"`
						ID       string       `json:"id"`
						Function toolFunction `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
				FinishReason string `json:"finish_reason"`
			} `json:"choices"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal([]byte(data), &chunk) != nil {
			continue
		}
		if chunk.Error != nil {
			return nil, false, errors.New("groq: stream error")
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		if chunk.Choices[0].FinishReason == "length" {
			cut = true
		}
		delta := chunk.Choices[0].Delta
		for _, tc := range delta.ToolCalls {
			c := calls[tc.Index]
			if c == nil {
				if len(calls) >= maxToolCalls {
					continue
				}
				c = &toolCall{Type: "function"}
				calls[tc.Index] = c
			}
			if tc.ID != "" {
				c.ID = tc.ID
			}
			if tc.Function.Name != "" {
				c.Function.Name = tc.Function.Name
			}
			if len(c.Function.Arguments)+len(tc.Function.Arguments) <= maxToolArgLen {
				c.Function.Arguments += tc.Function.Arguments
			}
		}
		piece, full := out.add(delta.Content)
		if piece != "" {
			if err := emit(piece); err != nil {
				return nil, false, err
			}
		}
		if full {
			return nil, true, nil
		}
	}
	if err := sc.Err(); err != nil {
		return nil, false, err
	}
	toolCalls := make([]toolCall, 0, len(calls))
	indexes := make([]int, 0, len(calls))
	for i := range calls {
		indexes = append(indexes, i)
	}
	sort.Ints(indexes)
	for _, i := range indexes {
		if c := calls[i]; c.Function.Name != "" {
			if c.ID == "" {
				c.ID = fmt.Sprintf("call_%d", i)
			}
			toolCalls = append(toolCalls, *c)
		}
	}
	if out.sent == "" && len(toolCalls) == 0 {
		return nil, false, errors.New("groq: empty reply")
	}
	return toolCalls, cut, nil
}

var thinkPattern = regexp.MustCompile(`(?s)<think>.*?</think>`)

const maxAnswerRunes = 4000

// answerFilter turns the raw stream into what the viewer sees: reasoning in
// <think> blocks is held back and dropped, and the answer stops at a cap.
type answerFilter struct {
	raw  strings.Builder
	sent string
}

func (f *answerFilter) add(chunk string) (piece string, full bool) {
	f.raw.WriteString(chunk)
	visible := visibleText(f.raw.String())
	if utf8.RuneCountInString(visible) > maxAnswerRunes {
		visible = string([]rune(visible)[:maxAnswerRunes])
		full = true
	}
	if !strings.HasPrefix(visible, f.sent) {
		return "", full
	}
	piece = visible[len(f.sent):]
	f.sent = visible
	return piece, full
}

func visibleText(raw string) string {
	s := thinkPattern.ReplaceAllString(raw, "")
	// A closing tag with no opening one ends reasoning the model started
	// without its tag. Text before it has already gone out, so stop there
	// rather than add the answer after it a second time.
	if i := strings.Index(s, "</think>"); i >= 0 {
		if strings.TrimSpace(s[:i]) == "" {
			s = s[i+len("</think>"):]
		} else {
			s = s[:i]
		}
	}
	if i := strings.Index(s, "<think>"); i >= 0 {
		s = s[:i]
	} else if j := strings.LastIndexByte(s, '<'); j >= 0 && (strings.HasPrefix("<think>", s[j:]) || strings.HasPrefix("</think>", s[j:])) {
		// Could be the start of a tag that hasn't fully arrived.
		s = s[:j]
	}
	return strings.TrimLeft(s, " \t\r\n")
}
