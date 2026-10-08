// Package httpapi exposes the links service over HTTP (net/http + chi).
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"agentic-aws/p1-shortener/internal/links"
)

// maxBodyBytes caps POST /links bodies: a 2048-byte URL plus JSON framing fits easily.
const maxBodyBytes = 8 << 10

// LinkService is the subset of links.Service the HTTP layer needs.
type LinkService interface {
	Create(ctx context.Context, rawURL string) (links.Link, error)
	Resolve(ctx context.Context, code string) (links.Link, error)
	Stats(ctx context.Context, code string) (links.Link, error)
}

type handler struct {
	svc    LinkService
	logger *slog.Logger
}

// NewRouter returns the shortener's HTTP handler. Its routes mirror the API Gateway routes
// (ADR-0002), so a path that reaches Lambda but not chi is a configuration drift.
func NewRouter(svc LinkService, logger *slog.Logger) http.Handler {
	h := &handler{svc: svc, logger: logger}
	r := chi.NewRouter()
	r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "not found")
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	})
	r.Post("/links", h.createLink)
	r.Get("/{code}", h.redirect)
	r.Get("/links/{code}", h.stats)
	return r
}

type createRequest struct {
	URL string `json:"url"`
}

type createResponse struct {
	Code     string `json:"code"`
	ShortURL string `json:"shortUrl"`
}

type statsResponse struct {
	URL       string `json:"url"`
	Clicks    int64  `json:"clicks"`
	CreatedAt string `json:"createdAt"`
}

func (h *handler) createLink(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	body := http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "body must be JSON like {\"url\": \"https://...\"}, at most 8 KiB")
		return
	}
	link, err := h.svc.Create(r.Context(), req.URL)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	w.Header().Set("Location", "/links/"+link.Code)
	writeJSON(w, http.StatusCreated, createResponse{Code: link.Code, ShortURL: baseURL(r) + "/" + link.Code})
}

func (h *handler) redirect(w http.ResponseWriter, r *http.Request) {
	link, err := h.svc.Resolve(r.Context(), chi.URLParam(r, "code"))
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	// Browsers cache 301s indefinitely; no-store keeps every click coming back to count it.
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Location", link.URL)
	w.WriteHeader(http.StatusMovedPermanently)
}

func (h *handler) stats(w http.ResponseWriter, r *http.Request) {
	link, err := h.svc.Stats(r.Context(), chi.URLParam(r, "code"))
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, statsResponse{
		URL:       link.URL,
		Clicks:    link.Clicks,
		CreatedAt: link.CreatedAt.UTC().Format(time.RFC3339),
	})
}

// writeServiceError maps domain errors to status codes. Anything unexpected is logged in full
// and answered with a generic 500, so AWS error details never reach the client.
func (h *handler) writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, links.ErrInvalidURL):
		writeError(w, http.StatusBadRequest, links.ErrInvalidURL.Error())
	case errors.Is(err, links.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	default:
		h.logger.ErrorContext(r.Context(), "request failed",
			"method", r.Method, "path", r.URL.Path, "code", chi.URLParam(r, "code"), "err", err)
		writeError(w, http.StatusInternalServerError, "internal error")
	}
}

// baseURL is the scheme and host the client used. Behind Lambda the adapter builds the
// request URL as https://<API domain>; a local http.Server leaves the scheme empty.
func baseURL(r *http.Request) string {
	scheme := r.URL.Scheme
	if scheme == "" {
		scheme = "http"
	}
	return scheme + "://" + r.Host
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	// The status line is already sent, so an encode failure can only mean the client went away.
	_ = json.NewEncoder(w).Encode(v)
}
