package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"

	"agentic-aws/p1-shortener/internal/links"
)

var errBoom = errors.New("boom: dynamodb exploded")

// fakeService returns a fixed link or error and records every call.
type fakeService struct {
	link  links.Link
	err   error
	calls []string
}

func (f *fakeService) Create(_ context.Context, rawURL string) (links.Link, error) {
	f.calls = append(f.calls, "Create "+rawURL)
	return f.link, f.err
}

func (f *fakeService) Resolve(_ context.Context, code string) (links.Link, error) {
	f.calls = append(f.calls, "Resolve "+code)
	return f.link, f.err
}

func (f *fakeService) Stats(_ context.Context, code string) (links.Link, error) {
	f.calls = append(f.calls, "Stats "+code)
	return f.link, f.err
}

var sampleLink = links.Link{
	Code:      "aB3xY9z",
	URL:       "https://aws.amazon.com/lambda/",
	Clicks:    7,
	CreatedAt: time.Date(2026, 10, 8, 14, 30, 0, 0, time.FixedZone("UTC+2", 2*60*60)),
	ExpiresAt: time.Date(2026, 11, 7, 12, 30, 0, 0, time.UTC),
}

// serve runs one request through the router and returns the recorder and captured logs.
func serve(t *testing.T, svc LinkService, req *http.Request) (*httptest.ResponseRecorder, string) {
	t.Helper()
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	rec := httptest.NewRecorder()
	NewRouter(svc, logger).ServeHTTP(rec, req)
	return rec, logs.String()
}

func decodeBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("response body is not JSON: %q (%v)", rec.Body.String(), err)
	}
	return got
}

func assertJSON(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
}

func TestCreateLink(t *testing.T) {
	tests := []struct {
		name         string
		target       string
		body         string
		svcErr       error
		wantStatus   int
		wantBody     map[string]any
		wantLocation string
		wantCalls    []string
	}{
		{
			name:         "created, http",
			target:       "http://short.test/links",
			body:         `{"url":"https://aws.amazon.com/lambda/"}`,
			wantStatus:   http.StatusCreated,
			wantBody:     map[string]any{"code": "aB3xY9z", "shortUrl": "http://short.test/aB3xY9z"},
			wantLocation: "/links/aB3xY9z",
			wantCalls:    []string{"Create https://aws.amazon.com/lambda/"},
		},
		{
			name:         "created, https keeps the scheme",
			target:       "https://short.test/links",
			body:         `{"url":"https://aws.amazon.com/lambda/"}`,
			wantStatus:   http.StatusCreated,
			wantBody:     map[string]any{"code": "aB3xY9z", "shortUrl": "https://short.test/aB3xY9z"},
			wantLocation: "/links/aB3xY9z",
			wantCalls:    []string{"Create https://aws.amazon.com/lambda/"},
		},
		{
			// A plain http.Server (cmd/local) leaves r.URL.Scheme empty.
			name:         "created, no scheme defaults to http",
			target:       "/links",
			body:         `{"url":"https://aws.amazon.com/lambda/"}`,
			wantStatus:   http.StatusCreated,
			wantBody:     map[string]any{"code": "aB3xY9z", "shortUrl": "http://example.com/aB3xY9z"},
			wantLocation: "/links/aB3xY9z",
			wantCalls:    []string{"Create https://aws.amazon.com/lambda/"},
		},
		{
			name:       "malformed JSON",
			target:     "http://short.test/links",
			body:       `{"url":`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "empty body",
			target:     "http://short.test/links",
			body:       ``,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "url is not a string",
			target:     "http://short.test/links",
			body:       `{"url":42}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "body over 8 KiB",
			target:     "http://short.test/links",
			body:       `{"url":"https://example.com/` + strings.Repeat("a", 9*1024) + `"}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "service rejects the url",
			target:     "http://short.test/links",
			body:       `{"url":"ftp://example.com"}`,
			svcErr:     links.ErrInvalidURL,
			wantStatus: http.StatusBadRequest,
			wantBody:   map[string]any{"error": links.ErrInvalidURL.Error()},
			wantCalls:  []string{"Create ftp://example.com"},
		},
		{
			name:       "codes exhausted is an internal error",
			target:     "http://short.test/links",
			body:       `{"url":"https://example.com"}`,
			svcErr:     links.ErrCodeExhausted,
			wantStatus: http.StatusInternalServerError,
			wantBody:   map[string]any{"error": "internal error"},
			wantCalls:  []string{"Create https://example.com"},
		},
		{
			name:       "store failure does not leak",
			target:     "http://short.test/links",
			body:       `{"url":"https://example.com"}`,
			svcErr:     errBoom,
			wantStatus: http.StatusInternalServerError,
			wantBody:   map[string]any{"error": "internal error"},
			wantCalls:  []string{"Create https://example.com"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := &fakeService{link: sampleLink, err: tt.svcErr}
			req := httptest.NewRequest(http.MethodPost, tt.target, strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")

			rec, logs := serve(t, svc, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body %q)", rec.Code, tt.wantStatus, rec.Body.String())
			}
			assertJSON(t, rec)
			got := decodeBody(t, rec)
			if tt.wantBody != nil {
				if diff := cmp.Diff(tt.wantBody, got); diff != "" {
					t.Errorf("body mismatch (-want +got):\n%s", diff)
				}
			} else if _, ok := got["error"]; !ok {
				t.Errorf("error response missing \"error\" field: %v", got)
			}
			if loc := rec.Header().Get("Location"); loc != tt.wantLocation {
				t.Errorf("Location = %q, want %q", loc, tt.wantLocation)
			}
			if diff := cmp.Diff(tt.wantCalls, svc.calls); diff != "" {
				t.Errorf("service calls mismatch (-want +got):\n%s", diff)
			}
			if tt.wantStatus == http.StatusInternalServerError {
				if strings.Contains(rec.Body.String(), "boom") {
					t.Errorf("500 body leaks internal error: %q", rec.Body.String())
				}
				if !strings.Contains(logs, tt.svcErr.Error()) {
					t.Errorf("real error not logged; logs = %q", logs)
				}
			}
		})
	}
}

func TestRedirect(t *testing.T) {
	tests := []struct {
		name       string
		svcErr     error
		wantStatus int
	}{
		{"found", nil, http.StatusMovedPermanently},
		{"not found", links.ErrNotFound, http.StatusNotFound},
		{"store failure", errBoom, http.StatusInternalServerError},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := &fakeService{link: sampleLink, err: tt.svcErr}

			rec, _ := serve(t, svc, httptest.NewRequest(http.MethodGet, "/aB3xY9z", nil))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if diff := cmp.Diff([]string{"Resolve aB3xY9z"}, svc.calls); diff != "" {
				t.Errorf("service calls mismatch (-want +got):\n%s", diff)
			}
			if tt.svcErr != nil {
				assertJSON(t, rec)
				if strings.Contains(rec.Body.String(), "boom") {
					t.Errorf("body leaks internal error: %q", rec.Body.String())
				}
				return
			}
			if loc := rec.Header().Get("Location"); loc != sampleLink.URL {
				t.Errorf("Location = %q, want %q", loc, sampleLink.URL)
			}
			if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
				t.Errorf("Cache-Control = %q, want no-store (browsers cache 301s and skip the counter)", cc)
			}
			if rec.Body.Len() != 0 {
				t.Errorf("301 body = %q, want empty", rec.Body.String())
			}
		})
	}
}

func TestStats(t *testing.T) {
	tests := []struct {
		name       string
		svcErr     error
		wantStatus int
		wantBody   map[string]any
	}{
		{
			name:       "found, createdAt in UTC",
			wantStatus: http.StatusOK,
			wantBody: map[string]any{
				"url":       "https://aws.amazon.com/lambda/",
				"clicks":    float64(7),
				"createdAt": "2026-10-08T12:30:00Z",
			},
		},
		{"not found", links.ErrNotFound, http.StatusNotFound, map[string]any{"error": "not found"}},
		{"store failure", errBoom, http.StatusInternalServerError, map[string]any{"error": "internal error"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := &fakeService{link: sampleLink, err: tt.svcErr}

			rec, _ := serve(t, svc, httptest.NewRequest(http.MethodGet, "/links/aB3xY9z", nil))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			assertJSON(t, rec)
			if diff := cmp.Diff(tt.wantBody, decodeBody(t, rec)); diff != "" {
				t.Errorf("body mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff([]string{"Stats aB3xY9z"}, svc.calls); diff != "" {
				t.Errorf("service calls mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestUnknownRoutesAndMethods(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		target     string
		wantStatus int
	}{
		{"unknown path", http.MethodGet, "/a/b/c", http.StatusNotFound},
		{"DELETE a link", http.MethodDelete, "/links/aB3xY9z", http.StatusMethodNotAllowed},
		{"PUT the collection", http.MethodPut, "/links", http.StatusMethodNotAllowed},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := &fakeService{}

			rec, _ := serve(t, svc, httptest.NewRequest(tt.method, tt.target, nil))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			assertJSON(t, rec)
			if _, ok := decodeBody(t, rec)["error"]; !ok {
				t.Errorf("missing \"error\" field: %q", rec.Body.String())
			}
			if len(svc.calls) != 0 {
				t.Errorf("service called: %v", svc.calls)
			}
		})
	}
}
