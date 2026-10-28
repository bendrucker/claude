---
name: writing:analyze
description: >-
  Audit the writing hook from its run log: volume, latency, per-check fire and
  suppress counts, and whether each finding was acted on. Use when reviewing
  hook health, judging a Vale check's precision in practice, or deciding which
  checks to demote or retire.
argument-hint: "[--since date] [--json]"
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
---

# Writing Analyze

The PreToolUse dispatcher (`hooks/pretooluse.ts`) appends one JSONL line per run to `~/.claude/writing-hooks/log.jsonl` (controlled by `WRITING_HOOKS_LOG`, see the plugin README). `hook-health.ts` reads it:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/hook-health.ts
bun ${CLAUDE_SKILL_DIR}/scripts/hook-health.ts --since 2026-07-01 --json
bun ${CLAUDE_SKILL_DIR}/scripts/hook-health.ts --log /path/to/log.jsonl
```

It reads the default log (plus its `.1` rotation) and reports run volume, outcome and tool breakdowns, latency percentiles for the silent hot path, per-check fire/suppress counts, an acted-on column, and the unconfirmed pairs no whole-file re-scan closed.

The acted-on column pairs each shown finding with the next whole-file re-scan of the same file: a check that re-scan no longer raises was acted on, one it still raises was written past. Only a whole-file run decides. The hook reports the alerts a run introduced, so a hunk-scoped `Edit` speaks only to its own new text, silent or not. Every shown finding no whole-file re-scan reached counts as `unconfirmed`, so the two columns account for all of them. The acted-on column reads `n/a` until pairs close. Recall is not measurable from this log, since a check that never fires leaves no line.

The report ends with an opportunities list, each naming a concrete fix. Flipping the `WRITING_HOOKS_LOG` default to off is offered only once acceptance is measurable. Fixes land as level overrides in `.vale.ini` or edits to `styles/Writing/`, and the next audit's log confirms or refutes them.
