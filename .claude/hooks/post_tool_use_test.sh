#!/usr/bin/env sh
set -e

uv run claude-hooks test post-tool-use --tool "Read" --output "file contents" -v
