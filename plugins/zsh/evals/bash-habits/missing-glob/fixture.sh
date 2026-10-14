#!/usr/bin/env bash
set -euo pipefail
mkdir -p config
printf 'port: 8080\n' > config/server.yaml
printf 'level: info\n' > config/logging.yaml
printf 'ttl: 60\n' > config/cache.yaml
printf 'Settings live here.\n' > config/README.txt
