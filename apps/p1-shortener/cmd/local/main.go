// Command local serves the shortener over plain HTTP against a real DynamoDB table, so the
// whole API can be curled before any Lambda exists:
//
//	TABLE_NAME=agentic-aws-dev-links AWS_PROFILE=learn-admin go run ./cmd/local
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"agentic-aws/p1-shortener/internal/httpapi"
	"agentic-aws/p1-shortener/internal/links"
	"agentic-aws/p1-shortener/internal/store"
)

const (
	// Loopback only: nothing else on the network can reach it, and Windows doesn't ask for a
	// firewall exception. Override with ADDR.
	defaultAddr     = "localhost:8080"
	shutdownTimeout = 5 * time.Second
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if err := run(logger); err != nil {
		logger.Error("local server failed", "err", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	table := os.Getenv("TABLE_NAME")
	if table == "" {
		return errors.New("TABLE_NAME is not set")
	}
	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = defaultAddr
	}
	// Locally, region and credentials come from AWS_PROFILE (~/.aws/config, SSO).
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return fmt.Errorf("load AWS config: %w", err)
	}
	svc := links.NewService(
		store.NewDynamo(dynamodb.NewFromConfig(cfg), table),
		func() time.Time { return time.Now().UTC() },
		links.NewCode,
	)
	srv := &http.Server{
		Addr:              addr,
		Handler:           httpapi.NewRouter(svc, logger),
		ReadHeaderTimeout: 5 * time.Second,
	}

	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	logger.Info("listening", "url", "http://"+addr, "table", table, "region", cfg.Region)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
		logger.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}
