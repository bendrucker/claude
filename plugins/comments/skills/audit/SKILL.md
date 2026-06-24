---
name: comments:audit
description: >-
  Audit a diff for AI slop code comments: restatement, narration/decision-log,
  self-praise, docstring-scope, and section-divider banners. Scopes to only the
  comments a change introduced and judges them against the two-type comment model.
  Use when reviewing a branch, working tree, or merge request for low-value
  comments before merge.
argument-hint: "[--base <ref>] [--mr <iid>] [--fix]"
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
---

# Comments Audit

Find low-value comments that a change introduced, scoped to added and modified
lines so pre-existing comments are never flagged. A deterministic tree-sitter
pass extracts comments, the diff scopes them, and an LLM judge calibrated to the
owner's comment model decides which are slop.

The judge only flags a comment when it fails the bar: a comment earns its place
when it adds information not readily available in the adjacent code. See
[`judge/prompt.md`](../../judge/prompt.md) for the full model and carve-outs.

## Prerequisites

Set `ANTHROPIC_API_KEY` in the environment. The judge calls the Anthropic
Messages API. The deterministic extraction and scoping need no key.

## Arguments

Forward `$ARGUMENTS` to `audit.ts` (see [Run](#run)):

- `--base <ref>`: judge comments introduced versus the merge-base with `<ref>`
  (e.g. `--base main`). Default: the working tree (staged plus unstaged).
- `--mr <iid>`: judge comments introduced by a GitLab merge request. Fetches the
  diff and file content over `glab`.
- `--fix`: include a concrete suggestion per flagged comment (rewrite-to-why,
  trim-to-lines, or delete). Default: flag only.
- `--model <id>`: override the judge model. Default: the harness default.

## Run

```bash
cd <plugin-dir> && bun skills/audit/scripts/audit.ts $ARGUMENTS
```

The script resolves the base, extracts and scopes the introduced comments, runs
the judge, and prints findings grouped by file as `path:line  category
confidence  rationale`. Deterministic tells (ticket breadcrumbs, hardcoded
line-number cross-references, section banners) are surfaced as an advisory marker
next to a finding; they do not gate the judge. Exit status is 0 with a report; it
is not a CI gate.

## Output

Each finding lists the file, the comment's line, the slop category, the judge's
confidence, and a one-line rationale. With `--fix`, a suggestion follows. A clean
diff prints nothing to flag.
