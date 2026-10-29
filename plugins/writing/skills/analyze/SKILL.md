---
name: writing:analyze
description: >-
  Audit the writing hook from its run log: outcomes, latency, per-check fire
  counts, and whether each alert was acted on. Use when reviewing
  hook health, judging a Vale check's precision in practice, or deciding which
  checks to demote or retire.
argument-hint: "[--since date] [--json]"
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
---

# Writing Analyze

The hook dispatcher (`hooks/lint.ts`) appends one JSONL line per run to `~/.claude/writing-hooks/log.jsonl` (controlled by `WRITING_HOOKS_LOG`, see the plugin README). `hook-health.ts` reads it:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/hook-health.ts
bun ${CLAUDE_SKILL_DIR}/scripts/hook-health.ts --since 2026-07-01 --json
bun ${CLAUDE_SKILL_DIR}/scripts/hook-health.ts --log /path/to/log.jsonl
```

It reads the default log (plus its `.1` rotation) and reports run count, outcomes, latency percentiles including the silent hot path, and per check its fire count, an acted-on column, and the alerts no whole-file re-lint reached.

The acted-on column pairs each shown alert with the next whole-file re-lint of the same file: a check that re-lint no longer raises was acted on, one it still raises was written past. Every file edit since the PostToolUse move lints the saved file. Older entries count only a `Write` as whole-file. Every shown alert no re-lint reached counts as `unconfirmed`, so the two columns account for all of them. The acted-on column reads `n/a` until pairs close. Recall is not measurable from this log, since a check that never fires leaves no line.

A check acted on less than half the time over 20 or more pairs reads prose wrong: sample those runs. A silent-run p95 above 100ms costs every file op. Fixes land as level overrides in `.vale.ini` or edits to `styles/Writing/`, and the next audit's log confirms or refutes them.
