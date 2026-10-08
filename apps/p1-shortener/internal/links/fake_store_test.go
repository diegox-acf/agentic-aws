package links

import (
	"context"
	"sync"
	"time"
)

// fakeStore is an in-memory Store. createErrs, when set, is consumed one error per
// Create call before falling back to normal behaviour, to simulate collisions.
type fakeStore struct {
	mu         sync.Mutex
	links      map[string]Link
	createErrs []error
	err        error // returned by every method when set

	createCalls int
	getCalls    int
	incCalls    int
}

func newFakeStore(seed ...Link) *fakeStore {
	f := &fakeStore{links: map[string]Link{}}
	for _, l := range seed {
		f.links[l.Code] = l
	}
	return f
}

func (f *fakeStore) Create(_ context.Context, link Link) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.createCalls++
	if f.err != nil {
		return f.err
	}
	if len(f.createErrs) > 0 {
		next := f.createErrs[0]
		f.createErrs = f.createErrs[1:]
		if next != nil {
			return next
		}
	}
	if _, ok := f.links[link.Code]; ok {
		return ErrCodeTaken
	}
	f.links[link.Code] = link
	return nil
}

func (f *fakeStore) Get(_ context.Context, code string) (Link, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.getCalls++
	if f.err != nil {
		return Link{}, f.err
	}
	l, ok := f.links[code]
	if !ok {
		return Link{}, ErrNotFound
	}
	return l, nil
}

func (f *fakeStore) IncrementClicks(_ context.Context, code string, now time.Time) (Link, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.incCalls++
	if f.err != nil {
		return Link{}, f.err
	}
	l, ok := f.links[code]
	if !ok || !l.ExpiresAt.After(now) {
		return Link{}, ErrNotFound
	}
	updated := l
	updated.Clicks++
	f.links[code] = updated
	return updated, nil
}
