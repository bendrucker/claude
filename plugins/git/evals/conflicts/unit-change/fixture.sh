#!/usr/bin/env bash
set -euo pipefail
dir=$(cd "$(dirname "$0")" && pwd)
bash "$dir/../scaffold.sh" "$dir"
