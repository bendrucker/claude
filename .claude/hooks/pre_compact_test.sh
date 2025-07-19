#!/usr/bin/env sh
set -e

uv run claude-hooks test pre-compact --session-id "test-789" -v
