//go:build linux

package upload

import "golang.org/x/sys/unix"

// freeBytes is the space an unprivileged writer can still use on the
// filesystem holding path.
func freeBytes(path string) (int64, error) {
	var st unix.Statfs_t
	if err := unix.Statfs(path, &st); err != nil {
		return 0, err
	}
	return int64(st.Bavail) * int64(st.Bsize), nil
}
