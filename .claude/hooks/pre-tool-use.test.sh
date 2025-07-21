#!/usr/bin/env sh
set -e

uv run claude-hooks test pre-tool-use --tool "Bash" --command "ls -la" -v
