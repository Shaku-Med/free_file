package worker

import "testing"

func TestResolveReel(t *testing.T) {
	cases := []struct {
		name    string
		mode    string
		seconds float64
		w, h    int
		want    *bool
	}{
		{"unknown everything", "auto", 0, 0, 0, nil},
		{"yes short", "yes", 60, 1920, 1080, boolPtr(true)},
		{"yes over cap denied", "yes", reelMaxSeconds + 1, 1080, 1920, boolPtr(false)},
		{"auto portrait over cap denied", "auto", 600, 1080, 1920, boolPtr(false)},
		{"auto short landscape", "auto", 45, 1920, 1080, boolPtr(true)},
		{"auto portrait under cap", "auto", 150, 1080, 1920, boolPtr(true)},
		{"auto long landscape", "auto", 600, 1920, 1080, boolPtr(false)},
		{"no always false", "no", 30, 1080, 1920, boolPtr(false)},
		{"yes no duration portrait", "yes", 0, 1080, 1920, boolPtr(true)},
	}
	for _, c := range cases {
		got := resolveReel(c.mode, c.seconds, c.w, c.h)
		if (got == nil) != (c.want == nil) || (got != nil && *got != *c.want) {
			t.Errorf("%s: resolveReel(%q, %v, %d, %d) = %v, want %v",
				c.name, c.mode, c.seconds, c.w, c.h, fmtBool(got), fmtBool(c.want))
		}
	}
}

func boolPtr(b bool) *bool { return &b }

func fmtBool(b *bool) interface{} {
	if b == nil {
		return nil
	}
	return *b
}
