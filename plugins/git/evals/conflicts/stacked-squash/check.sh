#!/usr/bin/env bash
set -euo pipefail
bun -e 'JSON.parse(await Bun.file(".claude-plugin/marketplace.json").text())'
