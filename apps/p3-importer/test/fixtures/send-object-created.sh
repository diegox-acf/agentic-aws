#!/usr/bin/env bash
# Sends the message EventBridge would put on the imports queue after an upload, so the importer
# can be tested before M3 wires S3 -> EventBridge -> SQS. Upload the file first (POST /imports,
# then the presigned POST), then:
#
#   ./send-object-created.sh <importId>
#
# Needs AWS_PROFILE (e.g. learn-admin). Reads names from the Terragrunt outputs.
set -euo pipefail
import_id="${1:?usage: $0 <importId>}"
here="$(cd "$(dirname "$0")" && pwd)"
live="$here/../../../../infra/live/dev/p3-importer"

bucket=$(cd "$live/bucket" && terragrunt output -raw bucket_name)
queue_url=$(cd "$live/queue" && terragrunt output -raw queue_url)
key="incoming/${import_id}.csv"
size=$(aws s3api head-object --bucket "$bucket" --key "$key" --query ContentLength --output text)

body=$(cat <<EOF
{"source":"aws.s3","detail-type":"Object Created","detail":{"bucket":{"name":"$bucket"},"object":{"key":"$key","size":$size},"reason":"PostObject"}}
EOF
)

aws sqs send-message --queue-url "$queue_url" --message-body "$body" --query MessageId --output text
