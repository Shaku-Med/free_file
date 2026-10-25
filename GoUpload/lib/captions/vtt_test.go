package captions

import (
	"strings"
	"testing"
)

func TestSanitizeKeepsWordTimesOnly(t *testing.T) {
	in := "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n" +
		"Hello <00:00:01.500>there <c.red>my</c> <script>alert(1)</script>friend <00:00:03.000 onload=x>again <01:00.250>now\n"
	out, n, err := Sanitize([]byte(in))
	if err != nil || n != 1 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	if !strings.Contains(out, "Hello <00:00:01.500>there") || !strings.Contains(out, "<01:00.250>now") {
		t.Fatalf("word times dropped:\n%s", out)
	}
	for _, bad := range []string{"<c", "</c>", "<script", "onload", "<00:00:03.000"} {
		if strings.Contains(out, bad) {
			t.Fatalf("%q survived:\n%s", bad, out)
		}
	}
}
