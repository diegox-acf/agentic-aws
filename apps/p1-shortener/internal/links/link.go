// Package links is the shortener's domain: link rules, code generation, and the Store port.
package links

import (
	"context"
	"errors"
	"time"
)

// TTL is how long a link stays resolvable after creation.
const TTL = 30 * 24 * time.Hour

var (
	ErrInvalidURL    = errors.New("invalid url: must be http or https with a host, at most 2048 bytes")
	ErrNotFound      = errors.New("link not found")
	ErrCodeTaken     = errors.New("code already taken")
	ErrCodeExhausted = errors.New("could not allocate a unique code")
)

// Link is a short code pointing at a target URL.
type Link struct {
	Code      string
	URL       string
	Clicks    int64
	CreatedAt time.Time
	ExpiresAt time.Time
}

// Store persists links. Implementations must be safe for concurrent use.
type Store interface {
	// Create stores a new link. Returns ErrCodeTaken if the code already exists.
	Create(ctx context.Context, link Link) error
	// Get returns the link for code, or ErrNotFound. It does not check expiry.
	Get(ctx context.Context, code string) (Link, error)
	// IncrementClicks atomically adds one click and returns the updated link.
	// Returns ErrNotFound if the code is missing or ExpiresAt <= now.
	IncrementClicks(ctx context.Context, code string, now time.Time) (Link, error)
}
