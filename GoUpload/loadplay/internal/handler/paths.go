package handler

import (
	"path"
	"strings"
)

// pathUnderPlaybackRoot returns true when asked lives under the directory
// that contains the token-bound manifest (e.g. master.m3u8). This covers
// ABR variant folders (480p/playlist.m3u8) and their segment files without
// letting a token for video A reach a sibling asset folder.
func pathUnderPlaybackRoot(asked, tokenPath string) bool {
	asked = path.Clean(strings.TrimPrefix(asked, "/"))
	tokenPath = path.Clean(strings.TrimPrefix(tokenPath, "/"))
	if asked == "" || tokenPath == "" {
		return false
	}
	for _, seg := range strings.Split(asked, "/") {
		if seg == ".." {
			return false
		}
	}
	root := path.Dir(tokenPath)
	if root == "." || root == "" {
		return false
	}
	if asked == root {
		return false
	}
	return strings.HasPrefix(asked, root+"/")
}
