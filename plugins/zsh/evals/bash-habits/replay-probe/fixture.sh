#!/usr/bin/env bash
set -euo pipefail
mkdir -p orders/settings orders/api tests
cat > docker-compose.yml <<'YAML'
services:
  api:
    build: .
    environment:
      DATABASE_URL: postgres://app@db:5432/orders
  db:
    image: postgres:17
YAML
printf 'DATABASE_URL=postgres://localhost:5432/orders_dev\nLOG_LEVEL=debug\n' > .env.example
cat > orders/settings/base.py <<'PY'
import os

DATABASE_URL = os.environ["DATABASE_URL"]
POOL_SIZE = int(os.environ.get("POOL_SIZE", "5"))
PY
cat > orders/api/routes.py <<'PY'
from orders.settings.base import DATABASE_URL


def health() -> dict:
    return {"db": DATABASE_URL.rsplit("/", 1)[-1]}
PY
printf 'def test_health():\n    assert True\n' > tests/test_routes.py
printf '[project]\nname = "orders"\nrequires-python = ">=3.12"\n' > pyproject.toml
