package usercap

import "time"

// Each of these runs a paid Google Vision check per request. A person changes
// a profile picture or cover a few times at most; these stop a script, not them.
var (
	ProfilePic = []Window{
		{Name: "profilepic_hour", Limit: 10, Per: time.Hour},
		{Name: "profilepic_day", Limit: 30, Per: 24 * time.Hour},
	}
	CommentImage = []Window{
		{Name: "commentimg_hour", Limit: 20, Per: time.Hour},
		{Name: "commentimg_day", Limit: 100, Per: 24 * time.Hour},
	}
	Thumbnail = []Window{
		{Name: "thumbnail_hour", Limit: 20, Per: time.Hour},
		{Name: "thumbnail_day", Limit: 60, Per: 24 * time.Hour},
	}
)

const (
	DefaultUploadsPerHour = 30
	DefaultUploadsPerDay  = 100
)

// NewUploads caps brand new uploads. Resuming one never counts.
func NewUploads(perHour, perDay int64) []Window {
	if perHour <= 0 {
		perHour = DefaultUploadsPerHour
	}
	if perDay <= 0 {
		perDay = DefaultUploadsPerDay
	}
	return []Window{
		{Name: "upload_hour", Limit: perHour, Per: time.Hour},
		{Name: "upload_day", Limit: perDay, Per: 24 * time.Hour},
	}
}
