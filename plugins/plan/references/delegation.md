# Delegation

Claude Code ships no auto-downgrade. A subagent inherits the orchestrator's model unless a lever sets otherwise, so an expensive orchestrator spawns expensive subagents by default. A review of a month of spawns found the generic path (`general-purpose`, `Plan`, bare `claude`) almost never delegated down: reasoning-grade tokens went to log reading and mechanical edits.

When the orchestrator runs on an expensive model (Opus, Fable, Mythos), the plan must carry a Delegation section that lays out the agent/model/effort DAG:

- Which slices delegate to which `model` and `effort`, and which stay on the orchestrator.
- Where checkpoints sit. A checkpoint is a slice whose output the orchestrator reads before the next slice starts.
- What runs in sequence versus parallel.

## Defaults

Match the model to the work, not to the orchestrator:

- Narrow, well-specified, high-token, low-reasoning work (reading logs, mechanical edits, grep sweeps) goes to **Haiku**.
- General-purpose work (bounded implementation, research with a settled question) goes to **Sonnet**.
- Coding under a Fable orchestrator goes to **Opus**.
- Reserve the orchestrator's own model for genuine reasoning: design forks, cross-slice synthesis, judgment a subagent cannot hold.

## Levers

- **Task-tool `model` override**: set `model` on the spawn. It wins over the subagent's frontmatter.
- **Subagent frontmatter** `model:` (`haiku`/`sonnet`/`opus`/`fable`) and `effort:` (`low`/`medium`/`high`/`xhigh`/`max`): the default when a spawn sets neither.
- **`subagent_type`**: a purpose-built agent that already pins a cheaper model (for example `github:logs` on Haiku) delegates down with no per-spawn override.
