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

	"github.com/awslabs/aws-lambda-go-api-proxy/httpadapter"
)

// logLines parses JSON log output into one map per line.
func logLines(t *testing.T, logs *bytes.Buffer) []map[string]any {
	t.Helper()
	var lines []map[string]any
	for raw := range strings.SplitSeq(strings.TrimSpace(logs.String()), "\n") {
		if raw == "" {
			continue
		}
		var line map[string]any
		if err := json.Unmarshal([]byte(raw), &line); err != nil {
			t.Fatalf("log line is not JSON: %q (%v)", raw, err)
		}
		lines = append(lines, line)
	}
	return lines
}

// requestLine returns the single "request" line, failing if there is not exactly one.
func requestLine(t *testing.T, lines []map[string]any) map[string]any {
	t.Helper()
	var found []map[string]any
	for _, l := range lines {
		if l["msg"] == "request" {
			found = append(found, l)
		}
	}
	if len(found) != 1 {
		t.Fatalf("got %d request log lines, want 1: %v", len(found), lines)
	}
	return found[0]
}

func TestRequestLog_BehindLambda(t *testing.T) {
	var logs bytes.Buffer
	router := NewRouter(&fakeService{link: sampleLink}, slog.New(slog.NewJSONHandler(&logs, nil)))
	event := v2Event(http.MethodGet, "/aB3xY9z", "", false)
	event.RequestContext.RequestID = "req-123"

	if _, err := httpadapter.NewV2(router).ProxyWithContext(context.Background(), event); err != nil {
		t.Fatalf("ProxyWithContext() error = %v", err)
	}

	line := requestLine(t, logLines(t, &logs))
	want := map[string]any{
		"level":      "INFO",
		"method":     "GET",
		"route":      "/{code}",
		"code":       "aB3xY9z",
		"status":     float64(http.StatusMovedPermanently), // JSON numbers decode as float64
		"request_id": "req-123",
	}
	for k, v := range want {
		if line[k] != v {
			t.Errorf("%s = %v, want %v", k, line[k], v)
		}
	}
	if _, ok := line["latency_ms"].(float64); !ok {
		t.Errorf("latency_ms = %v, want a number", line["latency_ms"])
	}
	if _, ok := line["url"]; ok {
		t.Error("request log contains the target url; it must not")
	}
}

func TestRequestLog_StatusPerOutcome(t *testing.T) {
	tests := []struct {
		name       string
		svcErr     error
		method     string
		path       string
		wantStatus float64
		wantRoute  string
		wantError  bool // the 500 path also logs the underlying error at ERROR
	}{
		{"created", nil, http.MethodPost, "/links", 201, "/links", false},
		{"store failure", errors.New("dynamodb: boom"), http.MethodGet, "/links/aB3xY9z", 500, "/links/{code}", true},
		{"unknown route", nil, http.MethodGet, "/a/b/c", 404, "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var logs bytes.Buffer
			router := NewRouter(&fakeService{link: sampleLink, err: tt.svcErr}, slog.New(slog.NewJSONHandler(&logs, nil)))
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(`{"url":"https://example.com"}`))

			router.ServeHTTP(httptest.NewRecorder(), req)

			lines := logLines(t, &logs)
			line := requestLine(t, lines)
			if line["status"] != tt.wantStatus || line["route"] != tt.wantRoute {
				t.Errorf("status, route = %v, %q; want %v, %q", line["status"], line["route"], tt.wantStatus, tt.wantRoute)
			}
			if line["request_id"] != "" {
				t.Errorf("request_id = %v, want empty outside Lambda", line["request_id"])
			}
			hasError := false
			for _, l := range lines {
				if l["level"] != "ERROR" {
					continue
				}
				hasError = true
				if _, ok := l["request_id"]; !ok {
					t.Errorf("ERROR line has no request_id, so it can't be joined to the access log: %v", l)
				}
			}
			if hasError != tt.wantError {
				t.Errorf("ERROR line logged = %v, want %v", hasError, tt.wantError)
			}
		})
	}
}
