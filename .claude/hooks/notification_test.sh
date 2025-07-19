#!/usr/bin/env sh
set -e

uv run claude-hooks test notification --message "Test notification" -v
