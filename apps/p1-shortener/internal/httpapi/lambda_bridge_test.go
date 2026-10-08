package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/awslabs/aws-lambda-go-api-proxy/httpadapter"
)

// These tests run API Gateway HTTP API (payload v2) events through the same adapter
// cmd/lambda uses, to prove the router works behind Lambda: base64 bodies are decoded and
// the API's own domain and https scheme reach the handlers.

const testDomain = "abc123.execute-api.us-east-1.amazonaws.com"

func proxy(t *testing.T, svc LinkService, event events.APIGatewayV2HTTPRequest) events.APIGatewayV2HTTPResponse {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	resp, err := httpadapter.NewV2(NewRouter(svc, logger)).ProxyWithContext(context.Background(), event)
	if err != nil {
		t.Fatalf("ProxyWithContext() error = %v", err)
	}
	return resp
}

func v2Event(method, path, body string, base64Body bool) events.APIGatewayV2HTTPRequest {
	return events.APIGatewayV2HTTPRequest{
		Version:         "2.0",
		RouteKey:        method + " " + path,
		RawPath:         path,
		Headers:         map[string]string{"content-type": "application/json", "host": testDomain},
		Body:            body,
		IsBase64Encoded: base64Body,
		RequestContext: events.APIGatewayV2HTTPRequestContext{
			DomainName: testDomain,
			HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{
				Method: method,
				Path:   path,
			},
		},
	}
}

func TestLambdaBridge_Redirect(t *testing.T) {
	svc := &fakeService{link: sampleLink}

	resp := proxy(t, svc, v2Event(http.MethodGet, "/aB3xY9z", "", false))

	if resp.StatusCode != http.StatusMovedPermanently {
		t.Fatalf("status = %d, want 301", resp.StatusCode)
	}
	if loc := resp.Headers["Location"]; loc != sampleLink.URL {
		t.Errorf("Location = %q, want %q", loc, sampleLink.URL)
	}
	if cc := resp.Headers["Cache-Control"]; cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
}

func TestLambdaBridge_CreateWithBase64Body(t *testing.T) {
	svc := &fakeService{link: sampleLink}
	body := base64.StdEncoding.EncodeToString([]byte(`{"url":"https://aws.amazon.com/lambda/"}`))

	resp := proxy(t, svc, v2Event(http.MethodPost, "/links", body, true))

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body %q)", resp.StatusCode, resp.Body)
	}
	var got struct {
		Code     string `json:"code"`
		ShortURL string `json:"shortUrl"`
	}
	if err := json.Unmarshal([]byte(resp.Body), &got); err != nil {
		t.Fatalf("body is not JSON: %q (%v)", resp.Body, err)
	}
	if want := "https://" + testDomain + "/aB3xY9z"; got.ShortURL != want {
		t.Errorf("shortUrl = %q, want %q", got.ShortURL, want)
	}
	if len(svc.calls) != 1 || svc.calls[0] != "Create https://aws.amazon.com/lambda/" {
		t.Errorf("service calls = %v, want the decoded URL", svc.calls)
	}
}
