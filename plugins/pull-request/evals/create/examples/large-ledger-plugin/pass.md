---
fail: []
---
Title: friction: add a ledger of recurring setup friction

Adds `friction`, which opens a PR mid-week only for a blocker with a small fix and lists the rest weekly.

- The model emits fingerprinted findings. `ledger.ts` counts and decides.
- Daily opens at most one draft PR. Weekly ranks by days seen.
