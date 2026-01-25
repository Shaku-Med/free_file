package routes

import (
	"net/http"

	"goupload/lib/response"
)

func healthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		response.Error(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
