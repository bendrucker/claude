#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
go build -o bin/docsync .
hyperfine --warmup 3 --runs 20 \
  'bin/docsync sync --manifest bench/fixtures/manifest.json --dir bench/fixtures/reference'
