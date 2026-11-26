#!/usr/bin/env bash
set -euo pipefail
bun install --frozen-lockfile --lockfile-only
grep --quiet '"yaml@2.8.0"' bun.lock
grep --quiet '"yaml@2.7.1"' bun.lock
grep --quiet '"zod@4.4.3"' bun.lock
