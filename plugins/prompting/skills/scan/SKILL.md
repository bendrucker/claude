---
name: prompting:scan
description: "Report prompt defects a lexical scan finds in documents a model executes. Use to audit a repository's skills, CLAUDE.md, agent definitions, or a product's prompt files, or to gate them in CI or a pre-commit hook."
argument-hint: "[<path>...] [--all] [--quiet]"
effort: low
allowed-tools:
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/scan.ts:*)
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/audit.ts:*)
  - Read
  - Edit
---

# Scan

Run the scanner over the paths in `$ARGUMENTS`, defaulting to the current directory:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/scan.ts [<path>...] [--all] [--quiet]
```

It reports each alert as `file:line:col: level: check: message` on stdout and a per-check count table on stderr, and exits non-zero on any alert. A check is an `error` once the precision eval confirms it and a `warning` until then. `--quiet` drops the table.

Without `--all` it reads the paths that hold documents a model executes: `SKILL.md`, `CLAUDE.md`, `AGENTS.md`, `.claude/agents`, `.claude/commands`, `.claude/rules`, a skill's `references/`, and a `prompt/` or `prompts/` directory holding `.md` or `.txt` files. Use `--all` for a prompt that lives somewhere else, such as one extracted from a string in a product repo. It reads `.md` and `.txt` under either setting, so `--all` widens which documents count without pulling in source files. It skips `node_modules`, `.git`, `fixtures`, `__snapshots__`, and `evals`.

## Checks

#### Rewrites

Sharpen the sentence the alert names.

- `Prompting.WeakModality`: the instruction is a suggestion the model can decline, so whether it fires is left to the run.
- `Prompting.VagueCriterion`: the done-state is one the model cannot check. The model decides for itself when to stop.

#### Deletions

Delete the span the alert names.

- `Prompting.NoOp`: the instruction restates a default the model already follows, spending context and changing nothing.
- `Prompting.StaleMeasurement`: the document reports a tally a past run counted. The run prints the number again, so the document caches its own output and drifts as the work behind it moves.
- `Prompting.TicketRef`: a bare issue number points at a tracker the model cannot read, and the prose around it goes stale when the issue closes.

## Acting on an Alert

An alert is a candidate. The scanner matches words rather than intent, so read the sentence and confirm it is an instruction before acting on it. A descriptive sentence that happens to contain the phrase is a false hit.

Load the `prompting` skill for the fix. Each check maps to a section: Sentence Form for weak modality, Completion Criteria for a vague criterion, and Pruning for the rest, under No-ops for a no-op, Cache for a stale measurement, and Relevance for a ticket reference, project status, or a maintainer aside.

## Gotchas

- Fenced blocks, inline code, quoted phrases, and blockquotes are exempt. A document that teaches a rule by showing the wording it rejects reports nothing.
- A linked issue keeps its context, so `TicketRef` reads only a bare number. A modal makes a number a budget rather than a result, so `can yield 2-3 cards` is not a measurement.
- Frontmatter is data, so a `description` field never raises an alert.
- An explicit path that is not agent-facing scans nothing and exits 0, which reads the same as a clean pass. Pass `--all` when naming a file outside the recognized paths.
- The checks cover what a lexical match can find with precision. Sprawl, duplication, and pointer wording need a reading pass against the `prompting` skill.
