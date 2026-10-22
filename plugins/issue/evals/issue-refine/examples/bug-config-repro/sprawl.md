---
fail: [repro-code, links-source, bullets-6, bullet-words-20, bullet-words-25, identifiers-10, no-provenance, no-tests-as-ac, context-words-100]
---
<issue>
---
title: API crash-loops when JSON logging and the OTLP log exporter are both on
type: bug
---

Preview API containers exit on startup when `LOG_FORMAT` is json and `OTEL_LOGS_EXPORTER` is otlp, per the changelog for opentelemetry-sdk 1.40. Workaround: unset OTEL_LOGS_EXPORTER.

## Details

- `configure_logging` attaches `OtlpHandler` whenever `LOG_FORMAT` is json, which used to be the only place a handler got attached, so nothing else ever collided with it before the dependency bump that landed last week across every service
- `HandlerRegistry.attach` raises on a duplicate
- `init_otel` runs first
- `deploy/preview.env` sets the exporter
- `dev/.env` reproduces it
- `dev/compose.yaml` runs it
- production is unaffected
- `api/logging` owns this

## Acceptance Criteria

- Tests cover both settings together

## 🤖 Agent Context

Taken from the reporter's notes. No code was read, so verify each symbol before relying on it. The registry lives in api/logging/registry.py and setup in api/logging/setup.py, the env files are dev/.env and deploy/preview.env, the compose file is dev/compose.yaml, the changelog is upstream, the SDK version is 1.40, the error is ValueError handler already attached otlp, and the handler is OtlpHandler attached from configure_logging when LOG_FORMAT is json and also by the SDK itself when OTEL_LOGS_EXPORTER is otlp, which is the collision this issue fixes in the API service only. The worker and scheduler services share the same logging setup module and the same registry, so they are likely affected too once their environments set the exporter.
</issue>
