---
name: writing:scan
description: >-
  Detect AI writing tropes in repository prose. Use `audit` to scan a directory
  or glob (READMEs, docs, skill files, proposals) for slop already committed and
  gate on it, reporting every match with file, line, and column. Use `score` to
  measure trope density of one input on a per-1000-word basis, compare two
  drafts, or score code comments separately. Not for rewriting a single input.
argument-hint: "audit <path...> | score <input>"
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# Scan

Detect AI writing tropes already present in prose. Every mode lints through Vale with the plugin's `.vale.ini`, the same checks the hook enforces on new edits. To transform a single input instead, use `writing:rewrite`.

## Audit

List the files or directories for Vale to lint. It walks directories itself and skips `node_modules` and `.git`:

```bash
vale --config="${CLAUDE_SKILL_DIR}/../../.vale.ini" --output=line docs README.md
vale --config="${CLAUDE_SKILL_DIR}/../../.vale.ini" --output=line --glob='*.md' .
```

Each alert prints as `path:line:col:check:message`, where `check` is the Vale rule name (`Writing.SpacedEmDash`, `ai-tells.EmDashUsage`). Vale exits 1 when any alert is at `error` level, so the command gates in CI or a pre-commit check.

Audit is report-only. Fix flagged files with `writing:rewrite` or direct edits at the reported positions.

## Single Input

`writing:rewrite` and other callers lint one input the same way:

```bash
vale --config="${CLAUDE_SKILL_DIR}/../../.vale.ini" --output=line path/to/draft.md
vale --config="${CLAUDE_SKILL_DIR}/../../.vale.ini" --output=line --ext=.prbody < body.md
```

- `--ext=.prbody` with the text on stdin applies the rules for a message sent once (PR, issue, comment, Notion page), including salutations and closers. Use `--ext=.commitmsg` for a commit message. The surface is never inferred, so pass it for a message body even when the text sits in a file.
- `--output=JSON` prints Vale's alerts keyed by path, each with `Check`, `Message`, `Severity`, `Line`, `Span`, and `Match`.

## Score

`score.ts` takes one file path, inline text, or stdin and reports Vale alerts per 1000 words for each check. It always exits 0.

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/score.ts path/to/draft.md
bun ${CLAUDE_SKILL_DIR}/scripts/score.ts --json path/to/draft.md
```

Word count is word tokens (`/[a-zA-Z]+/`) over the text with code stripped. Density is `alerts / (wordCount / 1000)`, and the table sorts by density.
