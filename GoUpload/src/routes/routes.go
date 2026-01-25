package routes

import (
	"io"
	"net/http"
)

type Uploader interface {
	StartResumable(size int64) (string, error)
	AppendResumable(id string, start, end, total int64, body io.Reader) (int64, bool, error)
	UploadSingle(reader io.Reader, size int64) (string, int64, error)
}

func NewRouter(uploader Uploader) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.Handle("/upload", uploadHandler(uploader))
	mux.Handle("/upload/", uploadSessionHandler(uploader))
	return mux
}
