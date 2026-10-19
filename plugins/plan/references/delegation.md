# Delegation

This plan is large enough to split across agents. A subagent inherits the orchestrator's model unless the spawn or its definition sets one, so give the plan a `## Delegation` section that lays out the agent/model/effort DAG:

- Which slices delegate to which `model` and `effort`, and which stay on the orchestrator.
- Where checkpoints sit: slices whose output the orchestrator reads before the next starts.
- What runs in sequence and what runs in parallel.

Match the model to the work:

- Narrow, high-token, low-reasoning work (logs, mechanical edits, grep sweeps): **Haiku**.
- Bounded implementation or research on a settled question: **Sonnet**.
- Coding under a Fable orchestrator: **Opus**.
- The orchestrator's own model: design forks, cross-slice synthesis, judgment a subagent cannot hold.

Then match the effort to the slice, and name it for every one, since an unset effort inherits the orchestrator's. Levels are not calibrated across models, so pick by the work:

- `low`: mechanical work, such as a rename, a known pattern applied across files, or log triage.
- `medium`: the default, for feature work and any slice the plan already specifies.
- `high`: work where verification matters or edge cases hide, such as a bug in brownfield code, or a slice whose earlier fix stopped at one layer.
- `xhigh`: a hard problem with many hidden edge cases, such as concurrency, a storage engine, or a migration with ordering constraints. Only spend it where it has shown a gain.
- `max`: not for a slice. It is for a whole session solving a hard problem autonomously, end to end.

Before raising a slice's effort, give it a way to check its work, such as a test to run. A check costs one turn, while effort adds thinking to every turn.

Set `model` and `effort` on the spawn (they beat the agent's frontmatter), or pick a `subagent_type` that already pins both, such as `github:logs` on Haiku at `low`.
