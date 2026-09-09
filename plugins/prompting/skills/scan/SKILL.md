---
name: prompting:scan
description: "Report prompt defects in documents a model executes: weak modality, vague completion criteria, and no-op instructions. Use to audit a repository's skills, CLAUDE.md, agent definitions, or a product's prompt files, or to gate them in CI or a pre-commit hook."
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

Without `--all` it reads the paths that hold documents a model executes: `SKILL.md`, `CLAUDE.md`, `AGENTS.md`, `.claude/agents`, `.claude/commands`, `.claude/rules`, a skill's `references/`, and a `prompts/` directory. Use `--all` for a prompt that lives somewhere else, such as one extracted from a string in a product repo.

## Rules

- `weak-modality`: the instruction is a suggestion the model can decline, so whether it fires is left to the run.
- `vague-criterion`: the done-state is one the model cannot check. The model decides for itself when to stop.
- `no-op`: the instruction restates a default the model already follows, spending context and changing nothing.

## Acting on a Finding

A finding is a candidate. The scanner matches words rather than intent, so read the sentence and confirm it is an instruction before rewriting it. A descriptive sentence that happens to contain the phrase is a false hit.

Load the `prompting` skill for the rewrite. Each rule maps to a section: Prescription for weak modality, Completion Criteria for a vague criterion, Pruning for a no-op.

## Gotchas

- Fenced blocks, inline code, and quoted phrases are exempt. A document that teaches a rule by showing the wording it rejects reports nothing.
- Frontmatter parses as data, so a `description` field never reports a finding.
- An explicit path that is not agent-facing scans nothing and exits 0, which reads the same as a clean pass. Pass `--all` when naming a file outside the recognized paths.
- The rule set covers what a lexical match can find with precision. Sprawl, duplication, and pointer wording need a reading pass against the `prompting` skill.
