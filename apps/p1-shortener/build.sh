#!/usr/bin/env bash
# Builds the Lambda binary for provided.al2023 on arm64. The runtime requires the name "bootstrap".
set -euo pipefail
cd "$(dirname "$0")"

# Env vars set inline apply to this one command only.
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 \
  go build -tags lambda.norpc -trimpath -ldflags '-s -w' -o dist/bootstrap ./cmd/lambda

echo "built dist/bootstrap"
