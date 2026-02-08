---
name: opentelemetry
description: >-
  OpenTelemetry instrumentation conventions. Use when instrumenting code with
  spans, setting up tracing, or writing trace tests.
user-invocable: false
---

# OpenTelemetry

## Span Naming

Use short, low-cardinality names from semantic conventions:

- HTTP: `GET /users/{id}` (method + route template, never full URL path)
- DB: `SELECT users` (operation + table)
- RPC: `grpc.health.v1.Health/Check`
- Messaging: `orders process` (destination + operation)

## Attributes

Use [semantic convention](https://opentelemetry.io/docs/specs/semconv/) attribute names — never invent your own:

- HTTP: `http.request.method`, `url.full`, `http.response.status_code`, `server.address`
- DB: `db.system`, `db.statement`, `db.namespace`
- General: `error.type`, `service.name`

Import from the versioned semconv package (e.g., `go.opentelemetry.io/otel/semconv/v1.x`).

## Status

Only set status on errors: `span.SetStatus(codes.Error, err.Error())`. Never set `Ok` — unset is the success state. Call `RecordError` alongside `SetStatus` (it only adds a span event, doesn't change status).

For HTTP: 4xx is `Error` on client spans, `Unset` on server spans. 5xx is always `Error`.

## Testing

Use in-memory exporters with `SimpleSpanProcessor` (not batch — batch introduces timing). Assert on exported spans' names, attributes, and status. No mocking needed.

## Boundaries

Instrument network calls, I/O, and queue operations — not every function. Use span events (`AddEvent`) instead of separate log statements for events within a traced operation.
