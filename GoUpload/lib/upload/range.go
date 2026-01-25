package upload

import (
	"errors"
	"strconv"
	"strings"
)

var ErrInvalidContentRange = errors.New("invalid_content_range")

func ParseContentRange(value string) (start, end, total int64, err error) {
	if value == "" {
		return 0, 0, 0, ErrInvalidContentRange
	}
	parts := strings.Split(value, " ")
	if len(parts) != 2 || parts[0] != "bytes" {
		return 0, 0, 0, ErrInvalidContentRange
	}
	rangeParts := strings.Split(parts[1], "/")
	if len(rangeParts) != 2 {
		return 0, 0, 0, ErrInvalidContentRange
	}
	byteRange := strings.Split(rangeParts[0], "-")
	if len(byteRange) != 2 {
		return 0, 0, 0, ErrInvalidContentRange
	}
	start, err = strconv.ParseInt(byteRange[0], 10, 64)
	if err != nil || start < 0 {
		return 0, 0, 0, ErrInvalidContentRange
	}
	end, err = strconv.ParseInt(byteRange[1], 10, 64)
	if err != nil || end < start {
		return 0, 0, 0, ErrInvalidContentRange
	}
	total, err = strconv.ParseInt(rangeParts[1], 10, 64)
	if err != nil || total <= 0 {
		return 0, 0, 0, ErrInvalidContentRange
	}
	return start, end, total, nil
}
