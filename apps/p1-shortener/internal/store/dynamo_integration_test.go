package store

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/google/go-cmp/cmp"

	"agentic-aws/p1-shortener/internal/links"
)

// Runs against a real table only when P1_TABLE is set:
//
//	P1_TABLE=agentic-aws-dev-links AWS_PROFILE=learn-admin go test -run Integration -v ./internal/store/
//
// It never deletes: test items expire within the hour and the TTL sweep removes them.
func integrationStore(t *testing.T) *Dynamo {
	t.Helper()
	table := os.Getenv("P1_TABLE")
	if table == "" {
		t.Skip("P1_TABLE not set; skipping DynamoDB integration test")
	}
	cfg, err := config.LoadDefaultConfig(context.Background(), config.WithRegion("us-east-1"))
	if err != nil {
		t.Fatalf("load AWS config: %v", err)
	}
	return NewDynamo(dynamodb.NewFromConfig(cfg), table)
}

func newTestLink(t *testing.T, now time.Time, expiresIn time.Duration) links.Link {
	t.Helper()
	code, err := links.NewCode()
	if err != nil {
		t.Fatalf("NewCode: %v", err)
	}
	return links.Link{
		Code:      code,
		URL:       "https://example.com/integration/" + code,
		CreatedAt: now,
		ExpiresAt: now.Add(expiresIn),
	}
}

func TestIntegration_Lifecycle(t *testing.T) {
	store := integrationStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	link := newTestLink(t, now, time.Hour)

	if err := store.Create(ctx, link); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := store.Create(ctx, link); !errors.Is(err, links.ErrCodeTaken) {
		t.Fatalf("second Create err = %v, want ErrCodeTaken", err)
	}

	got, err := store.Get(ctx, link.Code)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if diff := cmp.Diff(link, got); diff != "" {
		t.Errorf("Get mismatch (-want +got):\n%s", diff)
	}

	for want := int64(1); want <= 2; want++ {
		got, err := store.IncrementClicks(ctx, link.Code, now)
		if err != nil {
			t.Fatalf("IncrementClicks #%d: %v", want, err)
		}
		if got.Clicks != want || got.URL != link.URL {
			t.Errorf("IncrementClicks #%d = {clicks %d, url %q}, want {clicks %d, url %q}",
				want, got.Clicks, got.URL, want, link.URL)
		}
	}
}

func TestIntegration_MissingAndExpired(t *testing.T) {
	store := integrationStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)

	missing := newTestLink(t, now, time.Hour) // never created
	if _, err := store.Get(ctx, missing.Code); !errors.Is(err, links.ErrNotFound) {
		t.Errorf("Get missing err = %v, want ErrNotFound", err)
	}
	if _, err := store.IncrementClicks(ctx, missing.Code, now); !errors.Is(err, links.ErrNotFound) {
		t.Errorf("IncrementClicks missing err = %v, want ErrNotFound", err)
	}
	// The failed conditional update must not have created an item (UpdateItem is an upsert).
	if _, err := store.Get(ctx, missing.Code); !errors.Is(err, links.ErrNotFound) {
		t.Errorf("Get after failed increment err = %v, want ErrNotFound", err)
	}

	// Expired but not yet swept by TTL: still readable, but no longer redirects.
	expired := newTestLink(t, now.Add(-2*time.Minute), time.Minute)
	if err := store.Create(ctx, expired); err != nil {
		t.Fatalf("Create expired: %v", err)
	}
	if _, err := store.Get(ctx, expired.Code); err != nil {
		t.Errorf("Get expired err = %v, want the item (Service checks expiry, not Store.Get)", err)
	}
	if _, err := store.IncrementClicks(ctx, expired.Code, now); !errors.Is(err, links.ErrNotFound) {
		t.Errorf("IncrementClicks expired err = %v, want ErrNotFound", err)
	}
}
