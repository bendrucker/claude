# Delegation

This plan is large enough to split across agents. A subagent inherits the orchestrator's model unless the spawn or its definition sets one, so give the plan a `## Delegation` section that lays out the agent/model/effort DAG:

- Which slices delegate to which `model` and `effort`, and which stay on the orchestrator.
- Where checkpoints sit: slices whose output the orchestrator reads before the next starts.
- What runs in sequence and what runs in parallel.

Match the model to the work:

- Narrow, high-token, low-reasoning work (logs, mechanical edits, grep sweeps): **Haiku**, `effort: low` for a bounded tool task, `medium` for agentic work.
- Bounded implementation or research on a settled question: **Sonnet**.
- Coding under a Fable orchestrator: **Opus**.
- The orchestrator's own model: design forks, cross-slice synthesis, judgment a subagent cannot hold.

Set `model` on the spawn (it beats the agent's frontmatter), or pick a `subagent_type` that already pins a cheaper model, such as `github:logs` on Haiku.
