package security

import (
	"regexp"
	"time"
)

var timeUnitMap = map[string]time.Duration{
	"s": time.Second, "m": time.Minute, "h": time.Hour,
	"d": 24 * time.Hour, "w": 7 * 24 * time.Hour,
	"M": 30 * 24 * time.Hour, "y": 365 * 24 * time.Hour,
}

var timeExprRegex = regexp.MustCompile(`^(\d+)([smhdwMy])$`)

// ParseTimeExpression parses strings like "5s", "2m", "1d" and returns a time that far in the future.
func ParseTimeExpression(expr string) (time.Time, error) {
	m := timeExprRegex.FindStringSubmatch(expr)
	if m == nil {
		return time.Time{}, &ErrInvalidTimeExpr{Expr: expr}
	}
	// m[1]=value, m[2]=unit
	val := 0
	for _, c := range m[1] {
		val = val*10 + int(c-'0')
	}
	unit, ok := timeUnitMap[m[2]]
	if !ok {
		return time.Time{}, &ErrInvalidTimeExpr{Expr: expr}
	}
	return time.Now().Add(time.Duration(val) * unit), nil
}

// ErrInvalidTimeExpr is returned when the time expression is not like "5s", "2m", etc.
type ErrInvalidTimeExpr struct{ Expr string }

func (e *ErrInvalidTimeExpr) Error() string { return "invalid time expression: " + e.Expr }

// GetExpirationDate parses expiresIn (e.g. "6m", "1d") or uses "6m" and returns the expiration time.
func GetExpirationDate(expiresIn string) time.Time {
	if expiresIn == "" {
		expiresIn = "6m"
	}
	t, err := ParseTimeExpression(expiresIn)
	if err != nil {
		return time.Now().Add(6 * time.Minute)
	}
	return t
}
