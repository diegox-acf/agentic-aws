#!/usr/bin/env bash
# End-to-end check against the deployed API: create -> redirect -> stats, plus error paths.
# Usage: apps/p1-shortener/smoke.sh   (or API=https://... apps/p1-shortener/smoke.sh)
# Creates one real link; it expires after 30 days and DynamoDB TTL removes it.
set -euo pipefail

repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
api=${API:-$(cd "$repo/infra/live/dev/p1-shortener/api" && terragrunt output -raw api_endpoint 2>/dev/null)}
[[ -n "$api" ]] || { echo "no api_endpoint: is the api unit applied?" >&2; exit 1; }
echo "API: $api"

failures=0
check() { # check <description> <want> <got>
  if [[ "$2" == "$3" ]]; then echo "ok   $1"; else echo "FAIL $1: want '$2', got '$3'"; failures=$((failures + 1)); fi
}
json() { # json <.field> reads JSON on stdin and prints the field
  node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8'))$1"
}
request() { # request <curl args...> prints "<body>\n<status>"
  curl -s -w '\n%{http_code}' "$@"
}

target="https://aws.amazon.com/lambda/?smoke=$RANDOM"

resp=$(request -X POST "$api/links" -H 'content-type: application/json' -d "{\"url\":\"$target\"}")
body=${resp%$'\n'*}
check "POST /links status" 201 "${resp##*$'\n'}"
code=$(json .code <<<"$body")
check "shortUrl points at the API" "$api/$code" "$(json .shortUrl <<<"$body")"

check "GET /{code} redirects" "301 $target" "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$api/$code")"

resp=$(request "$api/links/$code")
check "GET /links/{code} status" 200 "${resp##*$'\n'}"
check "clicks after one redirect" 1 "$(json .clicks <<<"${resp%$'\n'*}")"

resp=$(request -X POST "$api/links" -H 'content-type: application/json' -d '{"url":"ftp://example.com"}')
check "non-http URL rejected" 400 "${resp##*$'\n'}"
check "unknown code" 404 "$(curl -s -o /dev/null -w '%{http_code}' "$api/links/zzzzzzz")"
check "unrouted method (API Gateway, no Lambda call)" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$api/links")"

if ((failures > 0)); then echo "$failures check(s) failed"; exit 1; fi
echo "all checks passed"
