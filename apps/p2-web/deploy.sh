#!/usr/bin/env bash
# Build the static export and publish it to the P2 bucket, then invalidate CloudFront.
# Infra must already be applied: infra/live/dev/p2-web/site and p1-shortener/api.
# Usage: apps/p2-web/deploy.sh
#   DRY_RUN=1  build and show what would be uploaded or deleted, without changing anything
#   API=https://...  build against another API instead of the p1-shortener/api output
set -euo pipefail

export AWS_PROFILE=${AWS_PROFILE:-learn-admin}
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
live=$repo/infra/live/dev
cd "$repo/apps/p2-web"

output() { # output <unit under infra/live/dev> <name>; empty if the unit isn't applied
  (cd "$live/$1" && terragrunt output -raw "$2" 2>/dev/null) || true
}

bucket=$(output p2-web/site bucket_name)
dist=$(output p2-web/site distribution_id)
domain=$(output p2-web/site domain_name)
api=${API:-$(output p1-shortener/api api_endpoint)}
[[ -n "$bucket" && -n "$dist" && -n "$domain" ]] || { echo "no site outputs: is p2-web/site applied?" >&2; exit 1; }
[[ -n "$api" ]] || { echo "no api_endpoint: is p1-shortener/api applied?" >&2; exit 1; }

dry=()
[[ "${DRY_RUN:-}" == 1 ]] && dry=(--dryrun)

# The CLI guesses Content-Type from the OS (on Windows, from the registry), and a wrong guess
# breaks the site: with the nosniff header a script not served as JavaScript is refused, and a
# .txt RSC payload not served as text/plain turns every client navigation into a full reload.
declare -A content_types=(
  [html]="text/html; charset=utf-8"
  [txt]="text/plain; charset=utf-8"
  [js]="text/javascript; charset=utf-8"
  [css]="text/css; charset=utf-8"
  [woff2]="font/woff2"
  [ico]="image/x-icon"
  [svg]="image/svg+xml"
  [png]="image/png"
)
immutable="public, max-age=31536000, immutable" # _next/static: names contain a content hash
revalidate="no-cache"                            # everything else: browsers check every time

# Workaround for a Next.js 16 static-export bug on Windows (vercel/next.js#85374, fix pending
# in PR #92340): segment prefetch files are written as stats/__next.stats/__PAGE__.txt, but
# the router requests stats/__next.stats.__PAGE__.txt, gets a 404 and falls back to the full
# payload. Rename them to the requested names. Builds on Linux/macOS have no such directories,
# so this does nothing there (or once Next is fixed).
flatten_segment_dirs() {
  local dir file rel
  while IFS= read -r -d '' dir; do
    while IFS= read -r -d '' file; do
      rel=${file#"$dir/"}
      mv "$file" "$dir.${rel//\//.}"
    done < <(find "$dir" -type f -print0)
    find "$dir" -depth -type d -empty -delete
  done < <(find out -type d -name '__next.*' -prune -print0)
}

echo "Building against $api"
pnpm test
NEXT_PUBLIC_API_URL=$api pnpm build
flatten_segment_dirs

# Fail before uploading anything if the export has a file type we have no Content-Type for.
mapfile -t exts < <(find out -type f -printf '%f\n' | sed 's/^[^.]*$/(none)/; s/.*\.//' | sort -u)
for ext in "${exts[@]}"; do
  [[ -v "content_types[$ext]" ]] || { echo "no Content-Type for .$ext files: add it to content_types" >&2; exit 1; }
done

upload() { # upload <local dir> <bucket prefix> <cache-control> [extra sync args...]
  local src=$1 prefix=$2 cache=$3
  shift 3
  for ext in "${exts[@]}"; do
    aws s3 sync "$src" "s3://$bucket/$prefix" --exclude '*' --include "*.$ext" "$@" \
      --content-type "${content_types[$ext]}" --cache-control "$cache" --only-show-errors "${dry[@]}"
  done
}

# Order matters for visitors mid-deploy: new hashed assets first, then the HTML that points at
# them, then remove pages that no longer exist. Old _next/static files are kept, so a tab
# still running the previous version can load its chunks.
echo "Uploading to s3://$bucket"
upload out/_next/static _next/static "$immutable"
upload out "" "$revalidate" --exclude '_next/static/*'
# --size-only: everything was just uploaded, so this pass only deletes (it never re-uploads a
# file with a guessed Content-Type because of a clock difference).
aws s3 sync out "s3://$bucket" --delete --size-only --exclude '_next/static/*' --only-show-errors "${dry[@]}"

if ((${#dry[@]})); then
  echo "Dry run: nothing uploaded, deleted or invalidated."
  exit 0
fi

# HTML is no-cache already; the invalidation also drops cached error pages and anything an
# earlier deploy cached with the wrong headers. "/*" counts as one path (1,000 free a month).
echo "Invalidating CloudFront cache"
id=$(MSYS_NO_PATHCONV=1 aws cloudfront create-invalidation --distribution-id "$dist" \
  --paths '/*' --query Invalidation.Id --output text)
aws cloudfront wait invalidation-completed --distribution-id "$dist" --id "$id"

site="https://$domain"
failures=0
check() { # check <path> <want "status content-type">
  local got
  got=$(curl -s --max-time 10 -o /dev/null -w '%{http_code} %{content_type}' "$site$1")
  if [[ "$got" == "$2" ]]; then echo "ok   $1 -> $got"; else echo "FAIL $1: want '$2', got '$got'"; failures=$((failures + 1)); fi
}
check / "200 text/html; charset=utf-8"
check /stats/ "200 text/html; charset=utf-8"
check /stats/index.txt "200 text/plain; charset=utf-8"
check /no-such-page/ "404 text/html; charset=utf-8"
((failures == 0)) || exit 1
echo "Live: $site"
