package logger

import (
	"fmt"
	"log"
	"os"
	"strings"
)

type Logger struct {
	base   *log.Logger
	maxLen int
}

func New(maxLen int) *Logger {
	if maxLen <= 0 {
		maxLen = 1024
	}
	return &Logger{
		base:   log.New(os.Stdout, "", log.LstdFlags),
		maxLen: maxLen,
	}
}

func (l *Logger) Infof(format string, args ...any) {
	l.base.Print(l.sanitize(fmt.Sprintf(format, args...)))
}

func (l *Logger) Errorf(format string, args ...any) {
	l.base.Print(l.sanitize(fmt.Sprintf(format, args...)))
}

func (l *Logger) sanitize(msg string) string {
	msg = strings.ReplaceAll(msg, "\r", " ")
	msg = strings.ReplaceAll(msg, "\n", " ")
	msg = strings.ReplaceAll(msg, "\t", " ")
	msg = strings.TrimSpace(msg)
	if len(msg) > l.maxLen {
		msg = msg[:l.maxLen]
	}
	return msg
}
