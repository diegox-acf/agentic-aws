package main

import (
	"context"
	"io"
	"log/slog"
	"testing"
)

func TestNewAdapter_RequiresTableName(t *testing.T) {
	t.Setenv("TABLE_NAME", "")

	_, err := newAdapter(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)))

	if err == nil || err.Error() != "TABLE_NAME is not set" {
		t.Fatalf("newAdapter err = %v, want \"TABLE_NAME is not set\"", err)
	}
}

func TestNewAdapter_Builds(t *testing.T) {
	// LoadDefaultConfig only reads config here; no AWS call happens until a request arrives.
	t.Setenv("TABLE_NAME", "test-table")
	t.Setenv("AWS_REGION", "us-east-1")

	adapter, err := newAdapter(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)))

	if err != nil || adapter == nil {
		t.Fatalf("newAdapter = (%v, %v), want an adapter and no error", adapter, err)
	}
}
