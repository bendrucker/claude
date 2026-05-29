---
name: writing:scan
description: >-
  Audit existing repository prose for AI writing tropes. Use when scanning a
  directory or set of files (READMEs, docs, skill files, proposals) for slop
  already committed, rather than rewriting one input. Reports every match with
  file, line, and column.
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# Scan

Report AI writing tropes already present in repository prose. This audits text in place. To transform a single input instead, use `writing:rewrite`.

## Input

`$ARGUMENTS` must include an explicit path: a directory or a glob. There is no implicit whole-repo scan.

```bash
${CLAUDE_SKILL_DIR}/scripts/scan.ts "docs/**/*.md"
${CLAUDE_SKILL_DIR}/scripts/scan.ts path/to/directory
```

Run with `--help` for all flags. The scanner walks the path, keeps prose files (`.md`, `.markdown`, `.txt`, `.mdx`, `.rst`, `.adoc`), and skips `node_modules`, `.git`, wordlists, and memory/plan paths.

## Output

Each violation prints as `path:line:col: category: message`. A summary table follows on stderr with counts per category and the noisiest files. The script exits non-zero when any violation is found, so it composes in CI or pre-commit checks.

Pass `--no-summary` to suppress the table when piping the per-line output elsewhere.

## Acting on results

The scan is report-only. To fix a flagged file, open it and run `writing:rewrite` on the offending passages, or edit directly using the reported positions. Bulk auto-fixing is not part of this skill.

The detection engine is shared with the `tropes` hook and the `writing:rewrite` lint script (`hooks/scan.ts` over `hooks/tropes.ts`), so a clean scan matches what the hook would allow on new edits.
