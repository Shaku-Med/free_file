package handler

import "strings"

// BuildVersion is injected at link time (-ldflags). "dev" when running via air.
var BuildVersion = "dev"

// SetBuildVersion updates the runtime build stamp (Docker / CI).
func SetBuildVersion(v string) {
	if v := strings.TrimSpace(v); v != "" {
		BuildVersion = v
	}
}
