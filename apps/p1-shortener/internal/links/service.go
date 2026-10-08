package links

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"time"
)

const (
	maxURLBytes  = 2048
	maxCodeTries = 3
)

// Service implements the shortener use cases on top of a Store.
type Service struct {
	store   Store
	clock   func() time.Time
	newCode func() (string, error)
}

// NewService wires a Service. Production code passes time.Now and NewCode.
func NewService(store Store, clock func() time.Time, newCode func() (string, error)) *Service {
	return &Service{store: store, clock: clock, newCode: newCode}
}

// Create validates rawURL and stores it under a fresh code, retrying on code collisions.
func (s *Service) Create(ctx context.Context, rawURL string) (Link, error) {
	if err := validateURL(rawURL); err != nil {
		return Link{}, err
	}
	now := s.clock()
	for range maxCodeTries {
		code, err := s.newCode()
		if err != nil {
			return Link{}, fmt.Errorf("generate code: %w", err)
		}
		link := Link{Code: code, URL: rawURL, CreatedAt: now, ExpiresAt: now.Add(TTL)}
		err = s.store.Create(ctx, link)
		if errors.Is(err, ErrCodeTaken) {
			continue
		}
		if err != nil {
			return Link{}, fmt.Errorf("store link: %w", err)
		}
		return link, nil
	}
	return Link{}, ErrCodeExhausted
}

// Resolve counts a click and returns the link to redirect to.
func (s *Service) Resolve(ctx context.Context, code string) (Link, error) {
	if !ValidCode(code) {
		return Link{}, ErrNotFound
	}
	link, err := s.store.IncrementClicks(ctx, code, s.clock())
	if err != nil {
		return Link{}, fmt.Errorf("resolve %s: %w", code, err)
	}
	return link, nil
}

// Stats returns the link without counting a click. Expired links are not found even if the
// TTL sweep has not deleted them yet.
func (s *Service) Stats(ctx context.Context, code string) (Link, error) {
	if !ValidCode(code) {
		return Link{}, ErrNotFound
	}
	link, err := s.store.Get(ctx, code)
	if err != nil {
		return Link{}, fmt.Errorf("stats %s: %w", code, err)
	}
	if !link.ExpiresAt.After(s.clock()) {
		return Link{}, ErrNotFound
	}
	return link, nil
}

// validateURL accepts absolute http(s) URLs with a host, at most maxURLBytes long.
func validateURL(raw string) error {
	if raw == "" || len(raw) > maxURLBytes {
		return ErrInvalidURL
	}
	u, err := url.Parse(raw)
	if err != nil {
		return ErrInvalidURL
	}
	// url.Parse lowercases the scheme, so "HTTPS" arrives here as "https".
	if (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ErrInvalidURL
	}
	return nil
}
