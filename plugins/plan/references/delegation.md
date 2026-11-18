# Delegation

Give this plan a `## Delegation` section naming each delegated slice's `model` and `effort`. A subagent inherits the orchestrator's model and effort unless the spawn sets them.

Model:

- **Haiku**: narrow, high-token, low-reasoning work (logs, mechanical edits, grep sweeps).
- **Sonnet**: bounded implementation or research on a settled question.
- **Opus**: coding under a Fable orchestrator.
- The orchestrator: design forks, cross-slice synthesis, judgment a subagent cannot hold.

Effort:

- `low`: a rename, a known pattern applied across files, log triage.
- `medium`: feature work and any slice the plan already specifies.
- `high`: brownfield bugs and slices whose edge cases hide. Give the slice a check to run first.
- `xhigh`: concurrency, storage engines, ordered migrations.

Set `model` and `effort` on the spawn, or pick a `subagent_type` that pins both.
