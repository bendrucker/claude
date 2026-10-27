#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bash "$here/../scripts/scaffold.sh" promptfoo guide
