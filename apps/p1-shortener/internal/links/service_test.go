package links

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
)

var (
	testNow = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	errBoom = errors.New("boom")
)

func fixedClock() time.Time { return testNow }

// codesSeq returns a newCode func that yields codes in order.
func codesSeq(codes ...string) func() (string, error) {
	i := 0
	return func() (string, error) {
		c := codes[i%len(codes)]
		i++
		return c, nil
	}
}

func liveLink(code string) Link {
	return Link{
		Code:      code,
		URL:       "https://example.com",
		Clicks:    4,
		CreatedAt: testNow.Add(-time.Hour),
		ExpiresAt: testNow.Add(TTL - time.Hour),
	}
}

func TestServiceCreate_ValidatesURL(t *testing.T) {
	prefix := "https://example.com/"
	tests := []struct {
		name    string
		url     string
		wantErr error
	}{
		{"valid https", "https://aws.amazon.com/lambda/", nil},
		{"valid http", "http://example.com", nil},
		{"uppercase scheme", "HTTPS://Example.com/Path", nil},
		{"exactly 2048 bytes", prefix + strings.Repeat("a", 2048-len(prefix)), nil},
		{"2049 bytes", prefix + strings.Repeat("a", 2049-len(prefix)), ErrInvalidURL},
		{"empty", "", ErrInvalidURL},
		{"ftp", "ftp://example.com/file", ErrInvalidURL},
		{"javascript", "javascript:alert(1)", ErrInvalidURL},
		{"data", "data:text/html,<script>alert(1)</script>", ErrInvalidURL},
		{"missing host", "https:///path", ErrInvalidURL},
		{"opaque, no host", "https:example.com", ErrInvalidURL},
		{"no scheme", "example.com/path", ErrInvalidURL},
		{"unparseable", "https://exa mple.com/%zz", ErrInvalidURL},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := newFakeStore()
			svc := NewService(store, fixedClock, codesSeq("aaaaaaa"))

			got, err := svc.Create(context.Background(), tt.url)

			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Create(%q) error = %v, want %v", tt.url, err, tt.wantErr)
			}
			if tt.wantErr != nil {
				if store.createCalls != 0 {
					t.Errorf("store.Create called %d times for an invalid URL", store.createCalls)
				}
				return
			}
			want := Link{Code: "aaaaaaa", URL: tt.url, CreatedAt: testNow, ExpiresAt: testNow.Add(TTL)}
			if diff := cmp.Diff(want, got); diff != "" {
				t.Errorf("Create() link mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(want, store.links["aaaaaaa"]); diff != "" {
				t.Errorf("stored link mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestServiceCreate_Codes(t *testing.T) {
	tests := []struct {
		name        string
		createErrs  []error
		storeErr    error
		newCode     func() (string, error)
		wantCode    string
		wantErr     error
		wantCreates int
	}{
		{
			name:        "first code free",
			newCode:     codesSeq("aaaaaaa"),
			wantCode:    "aaaaaaa",
			wantCreates: 1,
		},
		{
			name:        "collision twice then success",
			createErrs:  []error{ErrCodeTaken, ErrCodeTaken},
			newCode:     codesSeq("aaaaaaa", "bbbbbbb", "ccccccc"),
			wantCode:    "ccccccc",
			wantCreates: 3,
		},
		{
			name:        "collision three times",
			createErrs:  []error{ErrCodeTaken, ErrCodeTaken, ErrCodeTaken},
			newCode:     codesSeq("aaaaaaa", "bbbbbbb", "ccccccc"),
			wantErr:     ErrCodeExhausted,
			wantCreates: 3,
		},
		{
			name:        "store error is not retried",
			storeErr:    errBoom,
			newCode:     codesSeq("aaaaaaa"),
			wantErr:     errBoom,
			wantCreates: 1,
		},
		{
			name:        "code generator error",
			newCode:     func() (string, error) { return "", errBoom },
			wantErr:     errBoom,
			wantCreates: 0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := newFakeStore()
			store.createErrs = tt.createErrs
			store.err = tt.storeErr
			svc := NewService(store, fixedClock, tt.newCode)

			got, err := svc.Create(context.Background(), "https://example.com")

			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Create() error = %v, want %v", err, tt.wantErr)
			}
			if tt.wantErr != nil && errors.Is(err, ErrNotFound) {
				t.Errorf("Create() error %v must not look like ErrNotFound", err)
			}
			if got.Code != tt.wantCode {
				t.Errorf("Create() code = %q, want %q", got.Code, tt.wantCode)
			}
			if store.createCalls != tt.wantCreates {
				t.Errorf("store.Create calls = %d, want %d", store.createCalls, tt.wantCreates)
			}
		})
	}
}

func TestServiceResolve(t *testing.T) {
	expired := liveLink("eXpired")
	expired.ExpiresAt = testNow

	tests := []struct {
		name       string
		code       string
		storeErr   error
		want       Link
		wantErr    error
		wantInc    int
		wantClicks int64
	}{
		{"counts a click", "aB3xY9z", nil, withClicks(liveLink("aB3xY9z"), 5), nil, 1, 5},
		{"unknown code", "zzzzzzz", nil, Link{}, ErrNotFound, 1, 4},
		{"expired (ExpiresAt == now)", "eXpired", nil, Link{}, ErrNotFound, 1, 4},
		{"malformed code skips the store", "bad-code", nil, Link{}, ErrNotFound, 0, 4},
		{"store error propagated", "aB3xY9z", errBoom, Link{}, errBoom, 1, 4},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := newFakeStore(liveLink("aB3xY9z"), expired)
			store.err = tt.storeErr
			svc := NewService(store, fixedClock, codesSeq("unused0"))

			got, err := svc.Resolve(context.Background(), tt.code)

			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Resolve(%q) error = %v, want %v", tt.code, err, tt.wantErr)
			}
			if tt.storeErr != nil && errors.Is(err, ErrNotFound) {
				t.Errorf("store failure %v must not be reported as ErrNotFound", err)
			}
			if diff := cmp.Diff(tt.want, got); diff != "" {
				t.Errorf("Resolve() mismatch (-want +got):\n%s", diff)
			}
			if store.incCalls != tt.wantInc {
				t.Errorf("store.IncrementClicks calls = %d, want %d", store.incCalls, tt.wantInc)
			}
			if c := store.links["aB3xY9z"].Clicks; c != tt.wantClicks {
				t.Errorf("stored clicks = %d, want %d", c, tt.wantClicks)
			}
		})
	}
}

func TestServiceStats(t *testing.T) {
	expiredNow := liveLink("expNow1")
	expiredNow.ExpiresAt = testNow
	expiredPast := liveLink("expPast")
	expiredPast.ExpiresAt = testNow.Add(-time.Second)
	almostExpired := liveLink("almostX")
	almostExpired.ExpiresAt = testNow.Add(time.Second)

	tests := []struct {
		name     string
		code     string
		storeErr error
		want     Link
		wantErr  error
		wantGets int
	}{
		{"live link, no click counted", "aB3xY9z", nil, liveLink("aB3xY9z"), nil, 1},
		{"expires in one second", "almostX", nil, almostExpired, nil, 1},
		{"unknown code", "zzzzzzz", nil, Link{}, ErrNotFound, 1},
		{"expired (ExpiresAt == now)", "expNow1", nil, Link{}, ErrNotFound, 1},
		{"expired (ExpiresAt < now)", "expPast", nil, Link{}, ErrNotFound, 1},
		{"malformed code skips the store", "toolong12", nil, Link{}, ErrNotFound, 0},
		{"store error propagated", "aB3xY9z", errBoom, Link{}, errBoom, 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := newFakeStore(liveLink("aB3xY9z"), expiredNow, expiredPast, almostExpired)
			store.err = tt.storeErr
			svc := NewService(store, fixedClock, codesSeq("unused0"))

			got, err := svc.Stats(context.Background(), tt.code)

			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Stats(%q) error = %v, want %v", tt.code, err, tt.wantErr)
			}
			if tt.storeErr != nil && errors.Is(err, ErrNotFound) {
				t.Errorf("store failure %v must not be reported as ErrNotFound", err)
			}
			if diff := cmp.Diff(tt.want, got); diff != "" {
				t.Errorf("Stats() mismatch (-want +got):\n%s", diff)
			}
			if store.getCalls != tt.wantGets {
				t.Errorf("store.Get calls = %d, want %d", store.getCalls, tt.wantGets)
			}
			if store.incCalls != 0 {
				t.Errorf("Stats must not count clicks, IncrementClicks called %d times", store.incCalls)
			}
		})
	}
}

func withClicks(l Link, clicks int64) Link {
	l.Clicks = clicks
	return l
}
