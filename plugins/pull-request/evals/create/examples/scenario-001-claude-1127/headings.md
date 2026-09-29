---
fail: [heading-sentence-case, heading-question, heading-clause]
---
Title: session-limit: drop the hardcoded rate-limits path

The hardcoded machine-specific path exposed a private setup in both the README and the source.

## What changed and why

The fix matches the statusline writer's contract: the hook reads only from the env var, so unset means nothing is being written and the hook stays silent.

## Out of Scope (Deferred, Not Part of This PR)

Added test coverage for the unset-variable case to ensure graceful degradation.
