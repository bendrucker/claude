---
name: writing:score
description: >-
  Score a single input for AI writing patterns on a per-1000-word basis. Use to
  measure trope density across vocabulary, marketing verbs, and structural
  patterns, compare two drafts, or score code comments separately, without
  rewriting. Reports hit counts and density per category, never gates.
argument-hint: <file-path-or-text>
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# Score

Measure AI writing patterns in one input and report density per category. This quantifies trope load so you can compare drafts or track a file over time. To list every match with positions, use `writing:scan`. To rewrite an input, use `writing:rewrite`.

## Input

`$ARGUMENTS` is a single input: a file path, inline text, or stdin.

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/score.ts path/to/file.md
bun ${CLAUDE_SKILL_DIR}/scripts/score.ts "inline text to score"
cat draft.md | bun ${CLAUDE_SKILL_DIR}/scripts/score.ts
```

Run with `--help` for all flags.

## Scoring

The word count is word tokens (`/[a-zA-Z]+/`) over the text with code stripped, matching how the detection wordlists tokenize. Density is `hits / (wordCount / 1000)`, so it reads as hits per 1000 words. The raw word count prints in each group header so you can judge whether the sample is large enough to trust.

Hits are threshold-crossing counts from the shared detection engine (`detection/scan.ts`), the same categories the `tropes` hook and `writing:scan` use. A weighted group (marketing verbs, soft phrasing) counts as one hit when it crosses its threshold.

## Output

A table per group with category, hits, and density, sorted by density. The `--json` flag emits the structured report for diffing two runs. The command is informational: every run returns a success status, so it never gates anything.

## Comments

For non-prose source files, single-line comments (`//`, `#`) are extracted and scored as a separate `comments` group, so prose-only patterns apply to them without an AST. This is on by default for source files and off for prose files (`.md` and friends, whose fenced code blocks are already stripped). Force it with `--comments` or suppress it with `--no-comments`.

## Voice Delta

`--voice-delta` appends a table of voice rate features (first-person rate, sentence length, backtick density, and friends) beside the rates from the local voice baseline (`--data-dir` overrides the location). Each feature carries a provenance label: **skill-prescribed** drift means tune the skill, **skill-encouraged** deficits mean the skill is under-applied, and **ungoverned** features are genuine voice signal. A register check skips the baseline comparison for inputs too short or too markdown-heavy to compare against the PR-body baseline. The table is informational and never gates.

## Custom Vocabulary

`--wordlist <path>` compiles an extra stemmed vocabulary file (one term per line, `#` comments allowed) and scores it as a `custom vocabulary` category in every group. Use it to measure context-specific terms a general wordlist would not flag.
