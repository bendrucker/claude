---
name: writing:scan
description: >-
  Detect AI writing tropes in repository prose. Use `audit` to scan a directory
  or glob (READMEs, docs, skill files, proposals) for slop already committed and
  gate on it, reporting every match with file, line, and column. Use `score` to
  measure trope density of one input on a per-1000-word basis, compare two
  drafts, or score code comments separately. Not for rewriting a single input.
argument-hint: audit <path...> | score <input>
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# Scan

Detect AI writing tropes already present in prose. Two modes share the detection engine (`detection/scan.ts`), the same categories the `tropes` hook enforces on new edits. To transform a single input instead, use `writing:rewrite`.

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/scan.ts audit "docs/**/*.md"
bun ${CLAUDE_SKILL_DIR}/scripts/scan.ts score path/to/draft.md
```

Run either subcommand with `--help` for its flags.

## Exit Codes

`audit` exits non-zero when it finds any trope, so it gates in CI or a pre-commit check. `score` is informational and always exits 0.

## Audit

`audit <path...>` walks each directory or glob, keeps prose files (`.md`, `.markdown`, `.txt`, `.mdx`, `.rst`, `.adoc`), and skips `node_modules`, `.git`, wordlists, and memory/plan paths. There is no implicit whole-repo scan. Pass an explicit path.

Each violation prints as `path:line:col: category: message`. A summary table follows on stderr with per-category counts and the noisiest files.

Audit is report-only. Fix flagged files with `writing:rewrite` or direct edits at the reported positions.

## Score

`score <input>` takes one file path, inline text, or stdin and reports trope density per category.

Word count is word tokens (`/[a-zA-Z]+/`) over the text with code stripped, matching how the wordlists tokenize. Density is `hits / (wordCount / 1000)`, so it reads as hits per 1000 words. A weighted group (marketing verbs, soft phrasing) counts as one hit when it crosses its threshold.

The table sorts by density.

#### Comments

For non-prose source files, single-line comments (`//`, `#`) are extracted and scored as a separate `comments` group, so prose-only patterns apply to them without an AST. Prose files skip this because their fenced code blocks are already stripped.

#### Voice Delta

`--voice-delta` appends a table of voice rate features (first-person rate, sentence length, backtick density, and friends) beside the rates from the local voice baseline. Each feature carries a provenance label: **skill-prescribed** drift means tune the skill, **skill-encouraged** deficits mean the skill is under-applied, and **ungoverned** features are genuine voice signal. The register check skips inputs too short or too markdown-heavy to compare against the PR-body baseline.

#### Custom Vocabulary

`--wordlist <path>` compiles an extra stemmed vocabulary file (one term per line, `#` comments allowed) and scores it as a `custom vocabulary` category in every group, for context-specific terms a general wordlist would not flag.

## Single-Input Mode

`writing:rewrite` and other callers invoke `scan.ts --input` to lint one input against the audit categories without walking a directory. It reads a file path, inline text, or stdin and prints matches as `line:col: category: message` with no path prefix, exiting non-zero on any finding. This is the `audit` gate over a single input.
