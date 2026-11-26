#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=../fixture-lib.sh
source "$(dirname "$0")/../fixture-lib.sh"
session_status '{"state":"blocked","kind":"permission","msg":"Allow Bash(make deploy)?"}'
