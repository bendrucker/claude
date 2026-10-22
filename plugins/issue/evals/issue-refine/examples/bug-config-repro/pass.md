---
fail: []
---
<issue>
---
title: API crash-loops when JSON logging and the OTLP log exporter are both on
type: bug
labels: [observability]
---

Preview API containers exit on startup with `ValueError: handler already attached: otlp`. Since [opentelemetry-sdk 1.40](https://github.com/example-otel/python-sdk/blob/main/CHANGELOG.md#1400), the SDK attaches an OTLP log handler itself when `OTEL_LOGS_EXPORTER=otlp`, and our JSON logging setup attaches a second one, which the registry rejects. Production breaks the day it sets the exporter.

```sh
# dev/.env
LOG_FORMAT=json
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318
OTEL_LOGS_EXPORTER=otlp

docker compose -f dev/compose.yaml up api
```

Workaround in preview: unset `OTEL_LOGS_EXPORTER`.

## 🤖 Agent Context

- `configure_logging` in `api/logging/setup.py` attaches `OtlpHandler`
- `HandlerRegistry.attach` in `api/logging/registry.py` raises on a duplicate
</issue>
