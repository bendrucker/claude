---
name: writing:scan
description: >-
  Detect AI writing tropes in repository prose. Use `audit` to scan a directory
  or glob (READMEs, docs, skill files, proposals) for slop already committed and
  gate on it, reporting every match with file, line, and column. Use `score` to
  measure trope density of one input on a per-1000-word basis, compare two
  drafts, or score code comments separately. Not for rewriting a single input.
argument-hint: audit <path...> | score <input> | --input <file> [--message]
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# Scan

Detect AI writing tropes already present in prose. Both modes lint through Vale with the plugin `.vale.ini`, the same checks the hook enforces on new edits. To transform a single input instead, use `writing:rewrite`.

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/scan.ts audit "docs/**/*.md"
bun ${CLAUDE_SKILL_DIR}/scripts/scan.ts score path/to/draft.md
```

Run either subcommand with `--help` for its flags.

## Exit Codes

`audit` exits non-zero when it finds any trope, so it gates in CI or a pre-commit check. `score` is informational and always exits 0.

## Audit

`audit <path...>` walks each directory or glob, keeps prose files (`.md`, `.markdown`, `.txt`, `.mdx`, `.rst`, `.adoc`), and skips `node_modules`, `.git`, and memory/plan paths. There is no implicit whole-repo scan. Pass an explicit path.

Each alert prints as `path:line:col: check: message`, where `check` is the Vale rule name (`Writing.SpacedEmDash`, `ai-tells.EmDashUsage`). A summary table follows on stderr with per-check counts and the noisiest files.

Audit is report-only. Fix flagged files with `writing:rewrite` or direct edits at the reported positions.

## Score

`score <input>` takes one file path, inline text, or stdin and reports Vale alerts per 1000 words for each check.

Word count is word tokens (`/[a-zA-Z]+/`) over the text with code stripped. Density is `alerts / (wordCount / 1000)`.

The table sorts by density.

#### Comments

For non-prose source files, comments are extracted and scored as a separate `comments` group. Prose files skip this because their fenced code blocks are already stripped.

## Single-Input Mode

`writing:rewrite` and other callers invoke `scan.ts --input` to lint one input against the audit checks without walking a directory. It reads a file path, inline text, or stdin and prints matches as `line:col: category: message` with no path prefix, exiting non-zero on any finding. This is the `audit` gate over a single input.

- `--message` treats the input as a message sent once (PR, issue, comment, commit, Notion page) and applies the rules for that surface, including salutations and closers. The surface is never inferred, so pass it for a message body even when the text sits in a file.
- `--json` prints the findings as a JSON array of `{ line, col, category, tier, matched, message }`, where `category` is the Vale check. The exit code is unchanged.
