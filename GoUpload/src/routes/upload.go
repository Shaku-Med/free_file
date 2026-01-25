package routes

import (
	"mime"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"

	"goupload/lib/response"
	"goupload/lib/upload"
)

func uploadHandler(uploader Uploader) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			response.Error(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}

		if isResumableInit(r) {
			size, ok := parseInt64Header(r, "X-Upload-Content-Length")
			if !ok {
				response.Error(w, http.StatusBadRequest, "missing_content_length")
				return
			}
			uploadID, err := uploader.StartResumable(size)
			if err != nil {
				writeUploadError(w, err)
				return
			}
			uploadURL := "/upload/" + uploadID
			w.Header().Set("Location", uploadURL)
			response.JSON(w, http.StatusCreated, map[string]string{
				"uploadId":  uploadID,
				"uploadUrl": uploadURL,
			})
			return
		}

		if !isMultipart(r.Header.Get("Content-Type")) {
			response.Error(w, http.StatusBadRequest, "multipart_required")
			return
		}

		reader, err := multipartReader(r)
		if err != nil {
			response.Error(w, http.StatusBadRequest, "invalid_multipart")
			return
		}

		part, err := findFilePart(reader)
		if err != nil {
			response.Error(w, http.StatusBadRequest, "file_required")
			return
		}
		defer part.Close()

		uploadID, received, err := uploader.UploadSingle(part, 0)
		if err != nil {
			writeUploadError(w, err)
			return
		}

		response.JSON(w, http.StatusCreated, map[string]any{
			"uploadId": uploadID,
			"received": received,
		})
	})
}

func uploadSessionHandler(uploader Uploader) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			response.Error(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}

		uploadID := strings.TrimPrefix(r.URL.Path, "/upload/")
		if uploadID == "" || uploadID == r.URL.Path {
			response.Error(w, http.StatusNotFound, "upload_not_found")
			return
		}

		start, end, total, err := upload.ParseContentRange(r.Header.Get("Content-Range"))
		if err != nil {
			response.Error(w, http.StatusBadRequest, "invalid_content_range")
			return
		}

		received, complete, err := uploader.AppendResumable(uploadID, start, end, total, r.Body)
		if err != nil {
			writeUploadError(w, err)
			return
		}

		if !complete {
			if received > 0 {
				w.Header().Set("Range", "bytes=0-"+formatInt(received-1))
			}
			w.WriteHeader(308)
			return
		}

		response.JSON(w, http.StatusCreated, map[string]any{
			"uploadId": uploadID,
			"received": received,
			"complete": true,
		})
	})
}

func isResumableInit(r *http.Request) bool {
	return r.Header.Get("X-Upload-Content-Length") != "" || r.Header.Get("X-Upload-Content-Type") != ""
}

func isMultipart(contentType string) bool {
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		return false
	}
	return strings.HasPrefix(mediaType, "multipart/")
}

func multipartReader(r *http.Request) (*multipart.Reader, error) {
	_, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil {
		return nil, err
	}
	return multipart.NewReader(r.Body, params["boundary"]), nil
}

func findFilePart(reader *multipart.Reader) (*multipart.Part, error) {
	for {
		part, err := reader.NextPart()
		if err != nil {
			return nil, err
		}
		if part.FormName() == "file" {
			return part, nil
		}
		_ = part.Close()
	}
}

func writeUploadError(w http.ResponseWriter, err error) {
	switch err {
	case upload.ErrTooLarge:
		response.Error(w, http.StatusRequestEntityTooLarge, "upload_too_large")
	case upload.ErrNotFound:
		response.Error(w, http.StatusNotFound, "upload_not_found")
	case upload.ErrRange, upload.ErrSizeMismatch:
		response.Error(w, http.StatusBadRequest, "invalid_range")
	default:
		response.Error(w, http.StatusInternalServerError, "upload_failed")
	}
}

func formatInt(value int64) string {
	return strconv.FormatInt(value, 10)
}

func parseInt64Header(r *http.Request, key string) (int64, bool) {
	value := r.Header.Get(key)
	if value == "" {
		return 0, false
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		return 0, false
	}
	return parsed, true
}
