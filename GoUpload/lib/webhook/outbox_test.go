package webhook

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// appAnswering stands in for the app's webhook endpoint, answering every call
// with status and counting them.
func appAnswering(t *testing.T, status int) *atomic.Int32 {
	t.Helper()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(status)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("APP_BASE_URL", srv.URL)
	t.Setenv("UPLOAD_WEBHOOK_SECRET", "test-secret")
	old := firstBackoff
	firstBackoff = time.Millisecond
	t.Cleanup(func() { firstBackoff = old })
	return &calls
}

func keepUndelivered(t *testing.T) *[]Undelivered {
	t.Helper()
	var kept []Undelivered
	OnUndelivered(func(u Undelivered) { kept = append(kept, u) })
	t.Cleanup(func() { OnUndelivered(nil) })
	return &kept
}

func TestTerminalUpdateKeptWhenTheAppIsDown(t *testing.T) {
	calls := appAnswering(t, http.StatusBadGateway)
	kept := keepUndelivered(t)

	NotifyJobStatus(Payload{JobID: "j1", Status: "failed", UploadID: "u1"})

	if calls.Load() != 5 {
		t.Errorf("tried %d times, want 5", calls.Load())
	}
	if len(*kept) != 1 || (*kept)[0].Payload.UploadID != "u1" || (*kept)[0].Since.IsZero() {
		t.Fatalf("kept %+v, want the failed update for u1", *kept)
	}
	if Redeliver((*kept)[0]) {
		t.Error("Redeliver reported settled while the app is still down")
	}
}

func TestRejectedOrDeliveredUpdatesAreNotKept(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusConflict} {
		appAnswering(t, status)
		kept := keepUndelivered(t)
		NotifyJobStatus(Payload{JobID: "j1", Status: "completed", UploadID: "u1"})
		if len(*kept) != 0 {
			t.Errorf("http %d: kept %+v, want nothing", status, *kept)
		}
		if !Redeliver(Undelivered{Payload: Payload{Status: "completed", UploadID: "u1"}}) {
			t.Errorf("http %d: Redeliver should report settled", status)
		}
	}
}

func TestProgressUpdatesAreNeverKept(t *testing.T) {
	calls := appAnswering(t, http.StatusBadGateway)
	kept := keepUndelivered(t)
	NotifyJobStatus(Payload{JobID: "j1", Status: "running", UploadID: "u1"})
	if calls.Load() != 1 || len(*kept) != 0 {
		t.Errorf("running update: %d calls, kept %d; want 1 call and nothing kept", calls.Load(), len(*kept))
	}
}
