//go:build !linux

package upload

// Production runs on Linux; elsewhere the free space floor is skipped.
func freeBytes(string) (int64, error) { return 0, errNoStatfs }
