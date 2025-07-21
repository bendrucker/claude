#!/usr/bin/env sh
set -e

uv run claude-hooks test stop --session-id "test-123" -v
