#!/usr/bin/env bash
# Bundles each Lambda into dist/<function>/index.mjs. Terraform's archive_file zips those
# folders, and it reads them during `plan`, so build before planning the presign/importer units.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist

for fn in presign importer; do
  pnpm exec esbuild "src/${fn}/index.ts" \
    --bundle \
    --platform=node \
    --target=node24 \
    --format=esm \
    --minify \
    --outfile="dist/${fn}/index.mjs" \
    `# Some CommonJS dependencies call require(); an ESM bundle has no require unless we make one.` \
    --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"

  # Fails the build if the bundle can't even load (e.g. a missing require shim). The config
  # validates its env vars at load, so give it placeholders; nothing here calls AWS.
  IMPORTS_TABLE=build-smoke BUCKET_NAME=build-smoke LINKS_TABLE=build-smoke AWS_REGION=us-east-1 \
    RESULTS_TOPIC_ARN=arn:aws:sns:us-east-1:111111111111:build-smoke \
    node -e "import('./dist/${fn}/index.mjs').then(m => { if (typeof m.handler !== 'function') process.exit(1) })"
done

echo "built: $(ls dist | tr '\n' ' ')"
