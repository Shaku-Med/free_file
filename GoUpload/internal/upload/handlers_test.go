package upload

import (
	"reflect"
	"strings"
	"testing"
)

func TestCleanCategoriesKeepsOnlyTheUIList(t *testing.T) {
	in := []string{"gaming", "Gaming", " Music ", "Free Money", strings.Repeat("x", 5000), "Other"}
	want := []string{"Gaming", "Music", "Other"}
	if got := cleanCategories(in); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestCleanTagsAppliesTheUIRules(t *testing.T) {
	in := []string{" Cats ", "cats", "", strings.Repeat("a", 51), strings.Repeat("é", 50), "bad\x00tag"}
	for i := 0; i < 40; i++ {
		in = append(in, "t"+strings.Repeat("x", i))
	}
	got := cleanTags(in)
	if len(got) != maxTags {
		t.Fatalf("kept %d tags, want %d", len(got), maxTags)
	}
	if got[0] != "cats" || got[1] != strings.Repeat("é", 50) {
		t.Fatalf("got %q, want lower cased cats then the 50 character tag", got[:2])
	}
	for _, tag := range got {
		if tag == strings.Repeat("a", 51) || strings.ContainsRune(tag, 0) {
			t.Fatalf("kept %q", tag)
		}
	}
}
