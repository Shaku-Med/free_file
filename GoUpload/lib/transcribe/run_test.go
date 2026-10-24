package transcribe

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"goupload/lib/ffmpeg"
)

// TestRunRealWhisper runs whisper-cli end to end on a real clip. It only runs
// when WHISPER_MODEL and WHISPER_TEST_VIDEO are set (CI has neither):
//
//	WHISPER_MODEL=... WHISPER_VAD_MODEL=... WHISPER_BIN=... WHISPER_TEST_VIDEO=clip.mp4 go test -run RealWhisper -v ./lib/transcribe
func TestRunRealWhisper(t *testing.T) {
	video := os.Getenv("WHISPER_TEST_VIDEO")
	cfg, err := FromEnv()
	if video == "" || cfg == nil {
		t.Skip("WHISPER_MODEL and WHISPER_TEST_VIDEO not set")
	}
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	audio := filepath.Join(dir, "audio.flac")
	if err := ffmpeg.ExtractSpeechAudio(video, audio); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	res, err := cfg.Run(context.Background(), audio, dir, os.Getenv("WHISPER_TEST_SONG") != "")
	if err != nil {
		t.Fatal(err)
	}
	lang, vtt, cues, err := VTT(res)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("lang=%s cues=%d took=%s\n%s", lang, cues, time.Since(started).Round(time.Millisecond), vtt)
	if want := os.Getenv("WHISPER_TEST_EXPECT"); want != "" && !strings.Contains(strings.ToLower(vtt), strings.ToLower(want)) {
		t.Fatalf("captions do not contain %q", want)
	}
}
