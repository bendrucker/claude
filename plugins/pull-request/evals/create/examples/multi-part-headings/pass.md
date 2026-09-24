---
fail: []
---
Title: auth: harden the OAuth callback

Refactors the auth callback handler, narrows error matching to 401 and 403, and persists the DCR client ID across restarts.

## Deferred Work

The token-refresh rework is deferred to a follow-up, and the retry behavior is unchanged.
