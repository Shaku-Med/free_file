package nsfw

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
	if d.apiURL == "" || d.apiURL == "disabled" {
		return Result{IsNSFW: false}, nil
	}

	payload := struct {
		Image string `json:"image"`
	}{
		Image: base64.StdEncoding.EncodeToString(imageData),
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

	respBody, err := io.ReadAll(resp.Body)
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
	if len(images) == 0 {
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
	results := make([]batchResult, len(images))

	for i, img := range images {
		wg.Add(1)
		go func(idx int, data []byte) {
			defer wg.Done()
			res, err := d.Detect(data)
			results[idx] = batchResult{result: res, err: err}
		}(i, img)
	}

	wg.Wait()

	isAdult := false
	var firstResult *Result
	errCount := 0

	for _, br := range results {
		if br.err != nil {
			errCount++
			continue
		}
		if firstResult == nil {
			r := br.result
			firstResult = &r
		}
		if br.result.IsNSFW {
			isAdult = true
		}
	}

	if errCount == len(images) {
		return false, nil, fmt.Errorf("all detections failed")
	}

	return isAdult, firstResult, nil
}
