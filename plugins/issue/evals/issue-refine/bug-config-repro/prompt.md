Refine this into an issue:

The API container crash-loops on startup in preview deploys when structured logging and the OTLP log exporter are both on. Either one alone works.

What I found:
- It reproduces locally. With this in `dev/.env`:

  ```
  LOG_FORMAT=json
  OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318
  OTEL_LOGS_EXPORTER=otlp
  ```

  run `docker compose -f dev/compose.yaml up api`, and the container exits within a second with `ValueError: handler already attached: otlp`.
- `configure_logging` attaches an OTLP handler whenever LOG_FORMAT is json. Since opentelemetry-sdk 1.40, the SDK also attaches one itself when OTEL_LOGS_EXPORTER is otlp, and our handler registry refuses the second.
- We picked up 1.40 in the dependency bump last week. Preview sets OTEL_LOGS_EXPORTER; production doesn't yet, so production is fine until someone sets it there.
- Workaround for preview: unset OTEL_LOGS_EXPORTER. Logs still ship through our own handler.

Files:
- api/logging/setup.py (configure_logging attaches OtlpHandler when LOG_FORMAT is json)
- api/logging/registry.py (HandlerRegistry.attach raises on a duplicate name)
- deploy/preview.env (sets OTEL_LOGS_EXPORTER=otlp)

Sources:
- opentelemetry-sdk 1.40 changelog entry for auto-attached log handlers: https://github.com/example-otel/python-sdk/blob/main/CHANGELOG.md#1400
