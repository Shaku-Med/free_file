package nsfw

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// fakeVision stands in for NSFWAPI: /detect calls images named "gory..."
// harmful and "adult" adult, everything else clean; /gore answers with
// goreStatus/gore and records the images it was sent.
type fakeVision struct {
	mu         sync.Mutex
	goreStatus int
	gore       bool
	sent       [][]string
}

func (f *fakeVision) detector(t *testing.T) *Detector {
	t.Helper()
	decode := func(b string) string {
		img, _ := base64.StdEncoding.DecodeString(b)
		return string(img)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/nsfw/detect", func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Image string }
		_ = json.NewDecoder(r.Body).Decode(&body)
		res := Result{SafeSearch: &SafeSearch{Violence: "UNLIKELY"}}
		switch name := decode(body.Image); {
		case strings.HasPrefix(name, "gory"):
			res = Result{IsNSFW: true, Category: "harmful", FlagReason: "violent content", SafeSearch: &SafeSearch{Violence: "VERY_LIKELY"}}
		case name == "adult":
			res = Result{IsNSFW: true, Category: "adult", FlagReason: "adult content", SafeSearch: &SafeSearch{Adult: "VERY_LIKELY"}}
		}
		_ = json.NewEncoder(w).Encode(res)
	})
	mux.HandleFunc("/api/nsfw/gore", func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Images []string }
		_ = json.NewDecoder(r.Body).Decode(&body)
		var names []string
		for _, b := range body.Images {
			names = append(names, decode(b))
		}
		f.mu.Lock()
		f.sent = append(f.sent, names)
		f.mu.Unlock()
		if f.goreStatus != http.StatusOK {
			w.WriteHeader(f.goreStatus)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]bool{"gore": f.gore})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return NewDetector(srv.URL+"/api/nsfw/detect", "")
}

func images(names ...string) [][]byte {
	out := make([][]byte, len(names))
	for i, n := range names {
		out[i] = []byte(n)
	}
	return out
}

func TestConfirmedGorePhotoIsRefused(t *testing.T) {
	f := &fakeVision{goreStatus: http.StatusOK, gore: true}
	d := f.detector(t)
	res, err := d.Detect([]byte("gory"))
	if err != nil {
		t.Fatal(err)
	}
	d.CheckGore(&res)
	if !res.GoreConfirmed() || res.GoreCheck != "confirmed" {
		t.Fatalf("a yes should refuse the upload: %+v", res)
	}
	if len(f.sent) != 1 || strings.Join(f.sent[0], ",") != "gory" {
		t.Fatalf("the photo itself should be checked: %v", f.sent)
	}
}

func TestGoreNotConfirmedStaysPrivate(t *testing.T) {
	f := &fakeVision{goreStatus: http.StatusOK, gore: false}
	d := f.detector(t)
	res, _ := d.Detect([]byte("gory"))
	d.CheckGore(&res)
	if res.GoreConfirmed() || res.GoreCheck != "not confirmed" || res.Category != "harmful" {
		t.Fatalf("a no keeps the harmful flag but doesn't refuse: %+v", res)
	}
}

func TestGoreCheckFailingNeverRefuses(t *testing.T) {
	f := &fakeVision{goreStatus: http.StatusBadGateway}
	d := f.detector(t)
	res, _ := d.Detect([]byte("gory"))
	d.CheckGore(&res)
	if res.GoreConfirmed() || res.GoreCheck != "unavailable" || res.Category != "harmful" {
		t.Fatalf("no answer must leave the file private, not refused: %+v", res)
	}
}

func TestVideoSendsHarmfulFramesBeforeTheGrid(t *testing.T) {
	f := &fakeVision{goreStatus: http.StatusOK, gore: true}
	d := f.detector(t)
	_, res, err := d.DetectBatchWithGrid([]byte("gory grid"), images("gory 1", "clean", "adult", "gory 2"))
	if err != nil {
		t.Fatal(err)
	}
	d.CheckGore(res)
	if !res.GoreConfirmed() {
		t.Fatalf("expected confirmed gore: %+v", res)
	}
	if got := strings.Join(f.sent[0], ","); got != "gory 1,gory 2,gory grid" {
		t.Fatalf("sent %q, want only the harmful frames, full size first", got)
	}
}

func TestVideoGoreCheckIsCapped(t *testing.T) {
	f := &fakeVision{goreStatus: http.StatusOK, gore: false}
	d := f.detector(t)
	_, res, _ := d.DetectBatchWithGrid(nil, images("gory 1", "gory 2", "gory 3", "gory 4", "gory 5"))
	d.CheckGore(res)
	if got := len(f.sent[0]); got != maxGoreImages {
		t.Fatalf("sent %d images, want %d", got, maxGoreImages)
	}
}

func TestAdultIsNeverGoreChecked(t *testing.T) {
	f := &fakeVision{goreStatus: http.StatusOK, gore: true}
	d := f.detector(t)
	adult, res, _ := d.DetectBatchWithGrid(nil, images("adult", "clean"))
	d.CheckGore(res)
	if !adult || res.Category != "adult" || res.GoreCheck != "" || len(f.sent) != 0 {
		t.Fatalf("adult verdicts skip the gore check: %+v sent=%v", res, f.sent)
	}
}

func TestMergeReasonFollowsTheWorstCategory(t *testing.T) {
	merged := MergeResults([]*Result{
		{IsNSFW: true, Category: "adult", FlagReason: "racy content without safe context"},
		{IsNSFW: true, Category: "harmful", FlagReason: "violent content"},
		{IsNSFW: true, Category: "adult", FlagReason: "adult content"},
	})
	if merged.Category != "harmful" || merged.FlagReason != "violent content" {
		t.Fatalf("got %q / %q", merged.Category, merged.FlagReason)
	}
}
