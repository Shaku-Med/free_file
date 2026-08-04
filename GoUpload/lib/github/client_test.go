package github

import (
	"reflect"
	"testing"

	gh "github.com/google/go-github/v62/github"
)

func TestCollectDeletePathsRecursesAndFiltersPrefix(t *testing.T) {
	directories := map[string][]*gh.RepositoryContent{
		"04_08_2026/abc123": {
			{Type: gh.String("file"), Path: gh.String("04_08_2026/abc123/one.mp4")},
			{Type: gh.String("dir"), Path: gh.String("04_08_2026/abc123/subdir")},
		},
		"04_08_2026/abc123/subdir": {
			{Type: gh.String("file"), Path: gh.String("04_08_2026/abc123/subdir/two.mp4")},
			{Type: gh.String("file"), Path: gh.String("04_08_2026/abc123/subdir/keep.txt")},
		},
		"04_08_2026/other": {
			{Type: gh.String("file"), Path: gh.String("04_08_2026/other/ignored.mp4")},
		},
	}

	listDir := func(dir string) ([]*gh.RepositoryContent, error) {
		return directories[dir], nil
	}

	got, err := collectDeletePathsFromList("04_08_2026/abc123/", listDir)
	if err != nil {
		t.Fatalf("collectDeletePaths returned error: %v", err)
	}

	want := []string{
		"04_08_2026/abc123/one.mp4",
		"04_08_2026/abc123/subdir/two.mp4",
		"04_08_2026/abc123/subdir/keep.txt",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("collectDeletePaths() = %v, want %v", got, want)
	}
}

