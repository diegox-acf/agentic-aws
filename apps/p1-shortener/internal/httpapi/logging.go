package httpapi

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/awslabs/aws-lambda-go-api-proxy/core"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// logRequests writes one JSON line per request; Logs Insights queries its fields. The target
// URL is deliberately not logged. chi fills the route context while routing, so the route
// pattern and {code} are read after next returns.
func logRequests(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

			next.ServeHTTP(ww, r)

			status := ww.Status()
			if status == 0 { // handler wrote nothing and never called WriteHeader
				status = http.StatusOK
			}
			rctx := chi.RouteContext(r.Context())
			logger.InfoContext(r.Context(), "request",
				"method", r.Method,
				"route", rctx.RoutePattern(),
				"code", rctx.URLParam("code"),
				"status", status,
				"latency_ms", float64(time.Since(start).Microseconds())/1000,
				"request_id", requestID(r),
			)
		})
	}
}

// requestID is API Gateway's request ID, the same one its access log records, so one request
// can be followed across both log groups. Empty outside Lambda (cmd/local, plain tests).
func requestID(r *http.Request) string {
	if rc, ok := core.GetAPIGatewayV2ContextFromContext(r.Context()); ok {
		return rc.RequestID
	}
	return ""
}
