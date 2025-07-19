#!/usr/bin/env sh
set -e

uv run claude-hooks test subagent-stop --session-id "test-456" -v
