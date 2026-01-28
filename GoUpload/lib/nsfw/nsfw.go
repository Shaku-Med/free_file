package nsfw

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"sync"
	"time"
)

type Detector struct {
	apiURL    string
	apiSecret string
	client    *http.Client
}

type Result struct {
	IsNSFW bool
	Score  float64
}

func NewDetector(apiURL, apiSecret string) *Detector {
	if apiURL == "" {
		apiURL = "http://localhost:3004/api/nsfw/detect"
	}
	return &Detector{
		apiURL:    apiURL,
		apiSecret: apiSecret,
		client:    &http.Client{Timeout: 30 * time.Second},
	}
}

func (d *Detector) Detect(imageData []byte) (Result, error) {
	if d.apiURL == "" || d.apiURL == "disabled" {
		return Result{IsNSFW: false, Score: 0}, nil
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("image", "image.jpg")
	if err != nil {
		return Result{}, err
	}
	if _, err := part.Write(imageData); err != nil {
		return Result{}, err
	}
	if err := writer.Close(); err != nil {
		return Result{}, err
	}

	req, err := http.NewRequest("POST", d.apiURL, &body)
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if d.apiSecret != "" {
		req.Header.Set("X-Webhook-Secret", d.apiSecret)
	}

	resp, err := d.client.Do(req)
	if err != nil {
		return Result{IsNSFW: false, Score: 0}, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Result{IsNSFW: false, Score: 0}, nil
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return Result{}, err
	}

	// App returns { success, nsfw }; standalone may send { nsfw, score }
	var result struct {
		NSFW   bool    `json:"nsfw"`
		Score  float64 `json:"score"`
		Success *bool  `json:"success,omitempty"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return Result{}, err
	}
	// If success=false explicitly, treat as not NSFW
	if result.Success != nil && !*result.Success {
		return Result{IsNSFW: false, Score: 0}, nil
	}
	return Result{IsNSFW: result.NSFW, Score: result.Score}, nil
}

func (d *Detector) DetectBatch(images [][]byte) (bool, error) {
	if len(images) == 0 {
		return false, nil
	}

	if d.apiURL == "" || d.apiURL == "disabled" {
		return false, nil
	}

	var wg sync.WaitGroup
	resultCh := make(chan bool, len(images))
	errCh := make(chan error, len(images))

	for _, img := range images {
		wg.Add(1)
		go func(data []byte) {
			defer wg.Done()
			res, err := d.Detect(data)
			if err != nil {
				errCh <- err
				return
			}
			if res.IsNSFW {
				resultCh <- true
			}
		}(img)
	}

	wg.Wait()
	close(resultCh)
	close(errCh)

	for nsfw := range resultCh {
		if nsfw {
			return true, nil
		}
	}

	if len(errCh) == len(images) {
		return false, fmt.Errorf("all detections failed")
	}

	return false, nil
}
