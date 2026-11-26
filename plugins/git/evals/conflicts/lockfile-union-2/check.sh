#!/usr/bin/env bash
set -euo pipefail
bun install --frozen-lockfile --lockfile-only
grep --quiet '"semver@7.7.4"' bun.lock
grep --quiet '"semver@7.6.3"' bun.lock
grep --quiet '"commander@14.0.2"' bun.lock
