package nsfw

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

type VisionLabel struct {
	Name  string  `json:"name"`
	Score float64 `json:"score"`
}

type SafeSearch struct {
	Adult    string `json:"adult"`
	Violence string `json:"violence"`
	Racy     string `json:"racy"`
	Spoof    string `json:"spoof"`
	Medical  string `json:"medical"`
}

type Result struct {
	IsNSFW      bool          `json:"isNSFW"`
	Description string        `json:"description"`
	SafeSearch  *SafeSearch   `json:"safeSearch"`
	Labels      []VisionLabel `json:"labels"`
	// VLM-suggested canonical categories/tags (optional, set by NSFWAPI captioner)
	SuggestedCategories []string `json:"suggestedCategories,omitempty"`
	SuggestedTags       []string `json:"suggestedTags,omitempty"`
}

type Detector struct {
	apiURL    string
	apiSecret string
	client    *http.Client
}

func NewDetector(apiURL, apiSecret string) *Detector {
	if apiURL == "" {
		apiURL = "http://localhost:3004/api/nsfw/detect"
	}
	return &Detector{
		apiURL:    apiURL,
		apiSecret: apiSecret,
		client:    &http.Client{Timeout: 60 * time.Second},
	}
}

func (d *Detector) Detect(imageData []byte) (Result, error) {
	return d.detect(imageData, false)
}

// DetectGrid scans a thumbnail_preview-style frame grid. The isGrid flag lets
// the vision API caption it as "frames sampled across a video" instead of a
// single photo.
func (d *Detector) DetectGrid(imageData []byte) (Result, error) {
	return d.detect(imageData, true)
}

func (d *Detector) detect(imageData []byte, isGrid bool) (Result, error) {
	if d.apiURL == "" || d.apiURL == "disabled" {
		return Result{IsNSFW: false}, nil
	}

	payload := struct {
		Image  string `json:"image"`
		IsGrid bool   `json:"isGrid,omitempty"`
	}{
		Image:  base64.StdEncoding.EncodeToString(imageData),
		IsGrid: isGrid,
	}

	jsonBody, err := json.Marshal(payload)
	if err != nil {
		return Result{}, err
	}

	req, err := http.NewRequest("POST", d.apiURL, bytes.NewReader(jsonBody))
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if d.apiSecret != "" {
		req.Header.Set("X-Webhook-Secret", d.apiSecret)
	}

	resp, err := d.client.Do(req)
	if err != nil {
		return Result{}, fmt.Errorf("vision API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return Result{}, fmt.Errorf("vision API returned HTTP %d: %s", resp.StatusCode, string(body[:min(len(body), 300)]))
	}

	// Cap the response body: a misconfigured/compromised vision API shouldn't be
	// able to OOM the worker. The JSON verdict is tiny; 1 MiB is generous.
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return Result{}, err
	}

	var result Result
	if err := json.Unmarshal(respBody, &result); err != nil {
		return Result{}, err
	}
	return result, nil
}

func (d *Detector) DetectBatch(images [][]byte) (bool, *Result, error) {
	return d.DetectBatchWithGrid(nil, images)
}

// DetectBatchWithGrid scans sampled frames plus an optional thumbnail_preview
// grid (every frame of the video in one image). The grid result is merged
// FIRST so its caption/suggestions describe the whole video, while full-size
// frames keep adult detection sharp on small grid cells.
func (d *Detector) DetectBatchWithGrid(grid []byte, frames [][]byte) (bool, *Result, error) {
	total := len(frames)
	if len(grid) > 0 {
		total++
	}
	if total == 0 {
		return false, nil, nil
	}

	if d.apiURL == "" || d.apiURL == "disabled" {
		return false, nil, nil
	}

	type batchResult struct {
		result Result
		err    error
	}

	var wg sync.WaitGroup
	// Slot 0 is reserved for the grid so merge order is deterministic.
	results := make([]batchResult, total)
	offset := 0

	if len(grid) > 0 {
		offset = 1
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := d.DetectGrid(grid)
			results[0] = batchResult{result: res, err: err}
		}()
	}

	for i, img := range frames {
		wg.Add(1)
		go func(idx int, data []byte) {
			defer wg.Done()
			res, err := d.Detect(data)
			results[idx] = batchResult{result: res, err: err}
		}(offset+i, img)
	}

	wg.Wait()

	isAdult := false
	var ok []*Result
	errCount := 0

	for i := range results {
		if results[i].err != nil {
			errCount++
			continue
		}
		ok = append(ok, &results[i].result)
		if results[i].result.IsNSFW {
			isAdult = true
		}
	}

	if errCount == total {
		return false, nil, fmt.Errorf("all detections failed")
	}

	return isAdult, MergeResults(ok), nil
}

// safeSearchRank orders Vision SafeSearch likelihoods so we can keep the
// worst-case verdict across frames.
func safeSearchRank(v string) int {
	switch v {
	case "VERY_UNLIKELY":
		return 1
	case "UNLIKELY":
		return 2
	case "POSSIBLE":
		return 3
	case "LIKELY":
		return 4
	case "VERY_LIKELY":
		return 5
	default:
		return 0
	}
}

func worseLikelihood(a, b string) string {
	if safeSearchRank(b) > safeSearchRank(a) {
		return b
	}
	return a
}

func appendUnique(dst []string, seen map[string]bool, items []string) []string {
	for _, it := range items {
		key := strings.ToLower(strings.TrimSpace(it))
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		dst = append(dst, it)
	}
	return dst
}

// MergeResults combines per-image verdicts into one Result: labels are
// unioned keeping the max score, SafeSearch keeps the worst likelihood per
// field, and description/suggestions prefer the FIRST result (callers put
// the grid first  it sees the whole video).
func MergeResults(results []*Result) *Result {
	if len(results) == 0 {
		return nil
	}

	merged := &Result{}
	labelScore := map[string]float64{}
	labelName := map[string]string{}
	var labelOrder []string
	catSeen := map[string]bool{}
	tagSeen := map[string]bool{}

	for _, r := range results {
		if r == nil {
			continue
		}
		if r.IsNSFW {
			merged.IsNSFW = true
		}
		if merged.Description == "" && r.Description != "" {
			merged.Description = r.Description
		}
		if r.SafeSearch != nil {
			if merged.SafeSearch == nil {
				ss := *r.SafeSearch
				merged.SafeSearch = &ss
			} else {
				merged.SafeSearch.Adult = worseLikelihood(merged.SafeSearch.Adult, r.SafeSearch.Adult)
				merged.SafeSearch.Violence = worseLikelihood(merged.SafeSearch.Violence, r.SafeSearch.Violence)
				merged.SafeSearch.Racy = worseLikelihood(merged.SafeSearch.Racy, r.SafeSearch.Racy)
				merged.SafeSearch.Spoof = worseLikelihood(merged.SafeSearch.Spoof, r.SafeSearch.Spoof)
				merged.SafeSearch.Medical = worseLikelihood(merged.SafeSearch.Medical, r.SafeSearch.Medical)
			}
		}
		for _, l := range r.Labels {
			key := strings.ToLower(strings.TrimSpace(l.Name))
			if key == "" {
				continue
			}
			if _, exists := labelScore[key]; !exists {
				labelOrder = append(labelOrder, key)
				labelName[key] = l.Name
			}
			if l.Score > labelScore[key] {
				labelScore[key] = l.Score
			}
		}
		merged.SuggestedCategories = appendUnique(merged.SuggestedCategories, catSeen, r.SuggestedCategories)
		merged.SuggestedTags = appendUnique(merged.SuggestedTags, tagSeen, r.SuggestedTags)
	}

	for _, key := range labelOrder {
		merged.Labels = append(merged.Labels, VisionLabel{Name: labelName[key], Score: labelScore[key]})
	}

	return merged
}
