---
name: chief:chief
description: Drain or digest the chief ledger through the daemon's MCP tools. Invoked from the chief herdr pane by the doorbell and the 20-minute tick, never routed to by name.
argument-hint: "drain | digest"
disable-model-invocation: true
allowed-tools:
  - mcp__plugin_chief_chief__inbox
  - mcp__plugin_chief_chief__hold
  - mcp__plugin_chief_chief__ack
  - mcp__plugin_chief_chief__status
  - mcp__plugin_chief_chief__why
---

# Chief

$ARGUMENTS

## drain

Call `inbox` for the default open, held, and pushed rows. For each row, decide `hold` or `ack` following the `chief` agent's rules: `why` when the reason isn't clear, hold when it should wait, ack with a one-line `note` when it's handled. Then call `status` and print three lines: counts by tier, counts by state, and presence.

## digest

Call `inbox` with `tier: "digest"`. Rows still `pushed` are the ones released since the last digest; group them by `session`, newest first, and print one line each. Rows already `acked` were covered by a prior digest, so leave them out. Print one line saying nothing released when the filtered set is empty.
