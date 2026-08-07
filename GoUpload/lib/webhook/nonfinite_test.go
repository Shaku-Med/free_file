package webhook

import (
	"encoding/json"
	"math"
	"testing"
)

// Guards the bug that hung uploads at 95%: ffmpeg's loudnorm prints "-inf" for
// silent audio, strconv.ParseFloat accepts it, and json.Marshal then refuses the
// whole completion payload. The webhook returned on that error and the file row
// never left 'running'.
func TestScrubNonFiniteKeepsPayloadEncodable(t *testing.T) {
	p := Payload{
		JobID: "j", Status: "completed", UploadID: "u",
		Duration: math.NaN(),
		Metadata: map[string]interface{}{
			"loudness": map[string]interface{}{
				"integrated_lufs": math.Inf(-1),
				"range_lu":        19.5,
			},
			"video": map[string]interface{}{"width": 244.0},
		},
		Embedding: []float32{0.1, float32(math.Inf(1))},
	}

	if _, err := json.Marshal(p); err == nil {
		t.Fatal("expected marshal to fail before scrubbing")
	}

	scrubNonFinite(&p)

	b, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("marshal still failed after scrub: %v", err)
	}

	var back map[string]interface{}
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	md := back["metadata"].(map[string]interface{})
	loud := md["loudness"].(map[string]interface{})
	if loud["integrated_lufs"] != nil {
		t.Errorf("non-finite loudness should be null, got %v", loud["integrated_lufs"])
	}
	if loud["range_lu"] != 19.5 {
		t.Errorf("finite sibling was damaged: %v", loud["range_lu"])
	}
	if md["video"].(map[string]interface{})["width"] != 244.0 {
		t.Error("scrub damaged unrelated metadata")
	}
}

func TestParseLoudnessStringsStayFinite(t *testing.T) {
	for _, in := range []string{"-inf", "inf", "nan", "", "garbage", "-23.4"} {
		p := Payload{Status: "completed", Metadata: map[string]interface{}{"v": parseTestFloat(in)}}
		scrubNonFinite(&p)
		if _, err := json.Marshal(p); err != nil {
			t.Errorf("input %q left the payload unencodable: %v", in, err)
		}
	}
}

func parseTestFloat(s string) interface{} {
	switch s {
	case "-inf":
		return math.Inf(-1)
	case "inf":
		return math.Inf(1)
	case "nan":
		return math.NaN()
	case "-23.4":
		return -23.4
	}
	return s
}
