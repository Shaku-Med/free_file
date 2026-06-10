package nsfw

import "testing"

func TestMergeResultsEmpty(t *testing.T) {
	if MergeResults(nil) != nil {
		t.Fatal("expected nil for empty input")
	}
}

func TestMergeResultsPrefersFirstDescription(t *testing.T) {
	grid := &Result{Description: "a full video of a cat playing piano"}
	frame := &Result{Description: "a cat"}
	merged := MergeResults([]*Result{grid, frame})
	if merged.Description != "a full video of a cat playing piano" {
		t.Fatalf("expected grid description first, got %q", merged.Description)
	}
}

func TestMergeResultsLabelsUnionMaxScore(t *testing.T) {
	a := &Result{Labels: []VisionLabel{{Name: "Cat", Score: 0.7}, {Name: "Piano", Score: 0.9}}}
	b := &Result{Labels: []VisionLabel{{Name: "cat", Score: 0.95}, {Name: "Music", Score: 0.6}}}
	merged := MergeResults([]*Result{a, b})

	if len(merged.Labels) != 3 {
		t.Fatalf("expected 3 unique labels, got %d", len(merged.Labels))
	}
	for _, l := range merged.Labels {
		if l.Name == "Cat" && l.Score != 0.95 {
			t.Fatalf("expected Cat score 0.95 (max), got %v", l.Score)
		}
	}
}

func TestMergeResultsNSFWAnyAndWorstSafeSearch(t *testing.T) {
	clean := &Result{
		IsNSFW:     false,
		SafeSearch: &SafeSearch{Adult: "UNLIKELY", Violence: "VERY_UNLIKELY", Racy: "POSSIBLE"},
	}
	dirty := &Result{
		IsNSFW:     true,
		SafeSearch: &SafeSearch{Adult: "VERY_LIKELY", Violence: "UNLIKELY", Racy: "LIKELY"},
	}
	merged := MergeResults([]*Result{clean, dirty})

	if !merged.IsNSFW {
		t.Fatal("expected merged IsNSFW true when any frame is NSFW")
	}
	if merged.SafeSearch.Adult != "VERY_LIKELY" {
		t.Fatalf("expected worst-case adult VERY_LIKELY, got %s", merged.SafeSearch.Adult)
	}
	if merged.SafeSearch.Violence != "UNLIKELY" {
		t.Fatalf("expected worst-case violence UNLIKELY, got %s", merged.SafeSearch.Violence)
	}
	if merged.SafeSearch.Racy != "LIKELY" {
		t.Fatalf("expected worst-case racy LIKELY, got %s", merged.SafeSearch.Racy)
	}
}

func TestMergeResultsSuggestionsDeduped(t *testing.T) {
	a := &Result{SuggestedCategories: []string{"Music", "Entertainment"}, SuggestedTags: []string{"piano", "cat"}}
	b := &Result{SuggestedCategories: []string{"music", "Art"}, SuggestedTags: []string{"Piano", "cute"}}
	merged := MergeResults([]*Result{a, b})

	if len(merged.SuggestedCategories) != 3 {
		t.Fatalf("expected 3 categories (case-insensitive dedupe), got %v", merged.SuggestedCategories)
	}
	if len(merged.SuggestedTags) != 3 {
		t.Fatalf("expected 3 tags (case-insensitive dedupe), got %v", merged.SuggestedTags)
	}
}
