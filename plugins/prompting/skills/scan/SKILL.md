---
name: prompting:scan
description: "Report prompt defects a lexical scan finds in documents a model executes. Use to audit a repository's skills, CLAUDE.md, agent definitions, or a product's prompt files, or to gate them in CI or a pre-commit hook."
argument-hint: "[<path>] [--all] [--quiet]"
allowed-tools:
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/scan.ts:*)
  - Read
  - Edit
---

# Scan

Run the scanner over the path in `$ARGUMENTS`, defaulting to the current directory:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/scan.ts [<path>] [--all] [--quiet]
```

It reports each finding as `file:line:col: rule: message` on stdout and a per-rule count table on stderr, and exits non-zero when it finds any. `--quiet` drops the table.

Without `--all` it reads the paths that hold documents a model executes: `SKILL.md`, `CLAUDE.md`, `AGENTS.md`, `.claude/agents`, `.claude/commands`, `.claude/rules`, a skill's `references/`, and a `prompt/` or `prompts/` directory holding `.md` or `.txt` files. Use `--all` for a prompt that lives somewhere else, such as one extracted from a string in a product repo. A directory walk reads `.md` and `.txt` under either setting, so `--all` widens which documents count without pulling in source files.

## Rules

- `weak-modality`: the instruction is a suggestion the model can decline, so whether it fires is left to the run.
- `vague-criterion`: the done-state is one the model cannot check. The model decides for itself when to stop.
- `no-op`: the instruction restates a default the model already follows, spending context and changing nothing.
- `stale-measurement`: the document reports what a past run measured. The run prints the number again, so the document caches its own output and drifts as the work behind it moves.
- `ticket-ref`: a bare issue number points at a tracker the model cannot read, and the prose around it goes stale when the issue closes.
- `status-prose`: the document reports its own progress. A model executing it cannot act on unfinished work, and the note outlives the state it describes.
- `maintainer-aside`: prose held in a comment reaches the model, which pays for the tokens and cannot act on a note addressed to a person.

`stale-measurement`, `ticket-ref`, `status-prose`, and `maintainer-aside` resolve by deleting the span rather than rewording it.

## Acting on a Finding

A finding is a candidate. The scanner matches words rather than intent, so read the sentence and confirm it is an instruction before rewriting it. A descriptive sentence that happens to contain the phrase is a false hit.

Load the `prompting` skill for the rewrite. Each rule maps to a section: Sentence Form for weak modality, Completion Criteria for a vague criterion, and Pruning for the rest, under No-ops for a no-op, Cache for a stale measurement, and Relevance for a ticket reference, project status, or a maintainer aside.

## Gotchas

- Fenced blocks, inline code, quoted phrases, and blockquotes are exempt. A document that teaches a rule by showing the wording it rejects reports nothing.
- A linked issue keeps its context, so `ticket-ref` reads only a bare number. A modal makes a number a budget rather than a result, so `can yield 2-3 cards` is not a measurement.
- Frontmatter parses as data, so a `description` field never reports a finding.
- An explicit path that is not agent-facing scans nothing and exits 0, which reads the same as a clean pass. Pass `--all` when naming a file outside the recognized paths.
- The rule set covers what a lexical match can find with precision. Sprawl, duplication, and pointer wording need a reading pass against the `prompting` skill.
