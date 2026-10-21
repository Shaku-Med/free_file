package ffmpeg

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// makeClip renders a short 720p clip with a tone, so the ladder is
// 360p, 480p and the 720p source, with two audio rungs (low and mid).
func makeClip(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not on PATH")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe not on PATH")
	}
	clip := filepath.Join(t.TempDir(), "clip.mp4")
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=2",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=2",
		"-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("render clip: %v\n%s", err, out)
	}
	return clip
}

type publishCall struct {
	dirs        []string
	done, total int
	master      string
}

func TestProgressivePublishGoesLiveOnLowestQualityFirst(t *testing.T) {
	clip := makeClip(t)
	out := filepath.Join(t.TempDir(), "hls")
	var calls []publishCall
	res, err := ConvertToHLSAllQualities(clip, out, HLSOptions{
		SegmentTime: 6,
		Publish: func(newDirs []string, done, total int) error {
			master, rerr := os.ReadFile(filepath.Join(out, "master.m3u8"))
			if rerr != nil {
				return rerr
			}
			// Every folder handed over must already be complete on disk.
			for _, d := range newDirs {
				if _, serr := os.Stat(filepath.Join(out, d)); serr != nil {
					t.Errorf("published %s before it existed: %v", d, serr)
				}
			}
			calls = append(calls, publishCall{append([]string(nil), newDirs...), done, total, string(master)})
			return nil
		},
	})
	if err != nil {
		t.Fatalf("convert: %v", err)
	}
	if res.Partial != nil {
		t.Fatalf("unexpected partial: %v", res.Partial)
	}

	want := [][]string{{"360p", "audio_low"}, {"480p"}, {"source", "audio_mid"}}
	if len(calls) != len(want) {
		t.Fatalf("publish called %d times, want %d", len(calls), len(want))
	}
	for i, c := range calls {
		if !reflect.DeepEqual(c.dirs, want[i]) {
			t.Errorf("call %d dirs = %v, want %v", i+1, c.dirs, want[i])
		}
		if c.done != i+1 || c.total != len(want) {
			t.Errorf("call %d done/total = %d/%d", i+1, c.done, c.total)
		}
	}

	// The first master is watchable on its own and lists nothing that is not out yet.
	first := calls[0].master
	if !strings.Contains(first, "360p/playlist.m3u8") || !strings.Contains(first, `URI="audio_low/audio.m3u8"`) {
		t.Errorf("first master missing 360p or its audio:\n%s", first)
	}
	for _, later := range []string{"480p/", "source/", "audio_mid"} {
		if strings.Contains(first, later) {
			t.Errorf("first master lists %q before it was published:\n%s", later, first)
		}
	}
	last := calls[len(calls)-1].master
	for _, all := range []string{"360p/playlist.m3u8", "480p/playlist.m3u8", "source/playlist.m3u8", "audio_low/audio.m3u8", "audio_mid/audio.m3u8"} {
		if !strings.Contains(last, all) {
			t.Errorf("final master missing %q:\n%s", all, last)
		}
	}
	if len(res.Tiers) != 3 {
		t.Errorf("tiers = %d, want 3", len(res.Tiers))
	}
}

func TestProgressivePublishKeepsLiveQualitiesWhenALaterOneFails(t *testing.T) {
	clip := makeClip(t)
	out := filepath.Join(t.TempDir(), "hls")
	boom := errors.New("r2 down")
	res, err := ConvertToHLSAllQualities(clip, out, HLSOptions{
		SegmentTime: 6,
		Publish: func(_ []string, done, _ int) error {
			if done == 2 {
				return boom
			}
			return nil
		},
	})
	if err != nil {
		t.Fatalf("a failure after going live must not fail the video: %v", err)
	}
	if !errors.Is(res.Partial, boom) {
		t.Fatalf("partial = %v, want the publish error", res.Partial)
	}
	if len(res.Tiers) != 1 || res.Tiers[0].TierName != "360p" {
		t.Fatalf("kept tiers = %v, want only 360p", res.Tiers)
	}
}

func TestProgressivePublishFailsWhenNothingWentLive(t *testing.T) {
	clip := makeClip(t)
	boom := errors.New("r2 down")
	res, err := ConvertToHLSAllQualities(clip, filepath.Join(t.TempDir(), "hls"), HLSOptions{
		SegmentTime: 6,
		Publish:     func([]string, int, int) error { return boom },
	})
	if !errors.Is(err, boom) || res != nil {
		t.Fatalf("got res=%v err=%v, want the publish error and no result", res, err)
	}
}
