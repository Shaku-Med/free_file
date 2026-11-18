package quota

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func fakeApp(t *testing.T, handle func(w http.ResponseWriter, r *http.Request, body map[string]any)) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Webhook-Secret") != "s3cret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		handle(w, r, body)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("APP_BASE_URL", srv.URL+"/")
	t.Setenv("UPLOAD_WEBHOOK_SECRET", "s3cret")
}

const uploadID = "0123456789abcdef0123456789abcdef"

func TestAdmitSendsTheUploadAndReadsTheAnswer(t *testing.T) {
	fakeApp(t, func(w http.ResponseWriter, r *http.Request, body map[string]any) {
		if r.URL.Path != "/api/internal/quota-admit" || body["action"] != "admit" ||
			body["user_id"] != "u1" || body["upload_id"] != uploadID || body["bytes"] != float64(6<<30) {
			t.Errorf("unexpected request %s %v", r.URL.Path, body)
		}
		_, _ = w.Write([]byte(`{"ok":true,"used":6442450944,"limit":10737418240,"remaining":4294967296}`))
	})
	res, err := Admit(context.Background(), "u1", uploadID, 6<<30)
	if err != nil || !res.OK || res.Remaining != 4<<30 {
		t.Fatalf("got %+v, %v", res, err)
	}
}

func TestAdmitRefusalIsAnAnswerNotAnError(t *testing.T) {
	fakeApp(t, func(w http.ResponseWriter, _ *http.Request, _ map[string]any) {
		_, _ = w.Write([]byte(`{"ok":false,"used":9663676416,"limit":10737418240,"remaining":1073741824}`))
	})
	res, err := Admit(context.Background(), "u1", uploadID, 2<<30)
	if err != nil || res.OK || res.Remaining != 1<<30 {
		t.Fatalf("got %+v, %v", res, err)
	}
}

func TestReleaseNamesTheUpload(t *testing.T) {
	called := false
	fakeApp(t, func(w http.ResponseWriter, _ *http.Request, body map[string]any) {
		called = body["action"] == "release" && body["upload_id"] == uploadID && body["bytes"] == nil
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	if err := Release(context.Background(), "u1", uploadID); err != nil || !called {
		t.Fatalf("release err=%v called=%v", err, called)
	}
}

func TestNoClearAnswerMeansUnavailable(t *testing.T) {
	cases := map[string]func(w http.ResponseWriter){
		"server error": func(w http.ResponseWriter) { w.WriteHeader(http.StatusServiceUnavailable) },
		"not json":     func(w http.ResponseWriter) { _, _ = w.Write([]byte("<html>")) },
	}
	for name, reply := range cases {
		t.Run(name, func(t *testing.T) {
			fakeApp(t, func(w http.ResponseWriter, _ *http.Request, _ map[string]any) { reply(w) })
			if _, err := Admit(context.Background(), "u1", uploadID, 1); !errors.Is(err, ErrUnavailable) {
				t.Fatalf("admit err=%v", err)
			}
			if _, err := Check(context.Background(), "u1", 1); !errors.Is(err, ErrUnavailable) {
				t.Fatalf("check err=%v", err)
			}
		})
	}
}

func TestMissingConfigNeverAdmits(t *testing.T) {
	t.Setenv("APP_BASE_URL", "")
	t.Setenv("UPLOAD_WEBHOOK_SECRET", "")
	if _, err := Admit(context.Background(), "u1", uploadID, 1); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("err=%v", err)
	}
}
