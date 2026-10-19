// Command lambda runs the shortener on AWS Lambda behind an API Gateway HTTP API.
// Build it with ../../build.sh; the provided.al2023 runtime executes the binary "bootstrap".
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/awslabs/aws-lambda-go-api-proxy/httpadapter"

	"agentic-aws/p1-shortener/internal/httpapi"
	"agentic-aws/p1-shortener/internal/links"
	"agentic-aws/p1-shortener/internal/store"
)

func main() {
	// JSON lines in CloudWatch Logs, queryable with Logs Insights.
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	// Everything before lambda.Start runs once per cold start (the init phase), so the AWS
	// config and DynamoDB client are reused by every request this instance serves.
	adapter, err := newAdapter(context.Background(), logger)
	if err != nil {
		logger.Error("startup failed", "err", err)
		os.Exit(1)
	}
	lambda.Start(adapter.ProxyWithContext)
}

func newAdapter(ctx context.Context, logger *slog.Logger) (*httpadapter.HandlerAdapterV2, error) {
	table := os.Getenv("TABLE_NAME")
	if table == "" {
		return nil, errors.New("TABLE_NAME is not set")
	}
	// In Lambda, region and credentials come from the environment the runtime provides
	// (AWS_REGION and the execution role's temporary keys).
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("load AWS config: %w", err)
	}
	svc := links.NewService(
		store.NewDynamo(dynamodb.NewFromConfig(cfg), table),
		func() time.Time { return time.Now().UTC() },
		links.NewCode,
	)
	return httpadapter.NewV2(httpapi.NewRouter(svc, logger)), nil
}
