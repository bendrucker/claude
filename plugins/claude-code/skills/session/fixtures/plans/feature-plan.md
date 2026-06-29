# Feature Plan

## Context

The widget pipeline drops events under load. This plan adds backpressure.

## Plan

- Add a bounded queue in front of the consumer.
- Surface a depth metric.

### Queue Sizing

Default to 1024 entries, override via config.

## Verification

- `bun test` passes.
- Load test shows no dropped events at 2x throughput.
