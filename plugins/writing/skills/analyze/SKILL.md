---
name: writing:analyze
description: >-
  Curate the writing plugin's trope ruleset by auditing wordlist entries against
  session history and surfacing candidate phrases. Use when refreshing trope
  detection, reviewing wordlist health, or mining sessions for new AI-writing
  patterns to add or stale rules to remove.
argument-hint: "[--since date] [--model glob] [--judge]"
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Skill(claude-code:session)
---

# Writing Analyze

Mine the session DuckDB index for assistant writing patterns, compare against the user's voice, and propose a diff to `plugins/writing/wordlists/*.txt`.

## Arguments

Forward these from `$ARGUMENTS` to `analyze.ts` (see [Run](#run)):

- `--since <date>`: restrict the corpus to sessions on or after the date. Default: the full index.
- `--model <glob>`: restrict to matching model IDs (e.g. `*opus*`). Default: all models.
- `--judge`: add the LLM-judge pass over the deliverable corpus. See [Meaning-Layer Judge](#meaning-layer-judge). Default: off.

## Prerequisites

Activate the `claude-code:session` skill first. Run its refresh script to update the index and capture the DB path:

```bash
DB_PATH=$(<session-skill-dir>/scripts/refresh.ts --refresh)
```

The refresh script prints the resolved DB path to stdout.

Build the local voice baseline once, and refresh it as new writing accumulates. It is the comparison surface for deliverable-aware rule health, local-only and never committed, stored in the plugin data directory (`CLAUDE_PLUGIN_DATA`, else `~/.claude/plugins/data/writing-bendrucker`).

```bash
# Seed from the already-present delimited corpus (no re-fetch needed)
bun ${CLAUDE_SKILL_DIR}/scripts/ingest-voice.ts --source file --file <data-dir>/voice-baseline/github-prs.txt
# Or fetch fresh merged PRs (designed to add more sources later)
bun ${CLAUDE_SKILL_DIR}/scripts/ingest-voice.ts --source github --author <user> --created 2019-01-01..2025-01-01
# Build the profile the audit reads
bun ${CLAUDE_SKILL_DIR}/scripts/voice-profile.ts
```

Both scripts write to the plugin data directory, outside the default sandbox allowlist, so run them with `dangerouslyDisableSandbox: true` (or via a terminal outside Claude Code).

If no profile exists, analyze still runs: deliverable-surface rules fall back to the chat audit and the report flags the baseline as not loaded.

## Run

Pass the DB path via `--session-db`:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/analyze.ts --session-db "$DB_PATH"
```

Run with `--help` for the remaining flags. Writes a markdown report to `tmp/trope-analysis-<date>.md`. The report may quote any host in the combined index, so keep it under `tmp/` and never paste host-specific content into committed work.

## Meaning-Layer Judge

`--judge` adds an LLM-judge pass over the deliverable corpus. It requires `ANTHROPIC_API_KEY`, prints a cost estimate before any call, and caps documents with `--judge-limit` (default 100, cents per run on the default Haiku-class model):

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/analyze.ts --session-db "$DB_PATH" --judge
```

The judge prompt is a versioned artifact (`resources/judge/prompt.md`). The report records its hash, and numbers from different hashes are not comparable. Judge flag rates are uncalibrated until the #791 labeling passes run (a user checkpoint). The standalone runner covers ad-hoc files, the reproducibility gate, and the #769 heading baseline:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/judge-run.ts files <paths...>
bun ${CLAUDE_SKILL_DIR}/scripts/judge-run.ts gate
bun ${CLAUDE_SKILL_DIR}/scripts/judge-run.ts headings tmp/heading-labels.tsv
```

See the "Meaning-Layer Judge" section of [references/methodology.md](references/methodology.md) for the rubric, prompt versioning, gate, and calibration protocol.

## Detector Coverage

`wordlist-overlap.ts` ranks agent-authored prose (corpus A) against the pre-agent voice baseline (corpus B) by log-odds with an informative Dirichlet prior, then measures how much of that ranking the shipped detectors already cover. It reports both directions: discovered terms a detector matches, and curated entries the ranking independently places.

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/wordlist-overlap.ts
bun ${CLAUDE_SKILL_DIR}/scripts/wordlist-overlap.ts --baseline github-issues.txt --sizes 1 --sizes 2
bun ${CLAUDE_SKILL_DIR}/scripts/wordlist-overlap.ts --kind docs
```

Corpora A and B must match register. Contrasting mismatched genres raises the split-half null floor far above any real term and makes the ranking uninterpretable. Every run prints that floor, which is the z a finding has to clear.

Corpus A holds several genres, sorted by source path into the kinds `--kind` selects: `chat`, `plan`, `memory`, `scratch`, `docs`, and `other`. Only `docs`, the markdown committed to a repository for another reader, has a counterpart in a baseline of PR and issue text. Every run also splits each kind against itself, so the per-kind floors show what a pairing costs: unrestricted, the floor sits at 10.4 against a top score of 16.4, and `--kind docs` drops it to 4.3 against 13.9.

`--json` omits the example sentences the human-readable report already withholds, so no corpus prose reaches a file.

## Hook Health

The PreToolUse dispatcher (`hooks/pretooluse.ts`) appends one JSONL line per run to `~/.claude/writing-hooks/log.jsonl` (controlled by `WRITING_HOOKS_LOG`, see the plugin README). That log is the runtime half of this skill's audit: the wordlist analysis judges rule precision from session history, and the health check judges hook behavior from what the dispatcher actually did.

Run it before or alongside the wordlist audit:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/hook-health.ts
bun ${CLAUDE_SKILL_DIR}/scripts/hook-health.ts --since 2026-07-01 --json
bun ${CLAUDE_SKILL_DIR}/scripts/hook-health.ts --log /path/to/log.jsonl
```

It reads the default log (plus its `.1` rotation) and reports run volume, outcome and tool breakdowns, latency percentiles for the silent hot path, and per-category fire/suppress counts. The report ends with an opportunities list, each naming a concrete fix (including when a clean streak means flipping the `WRITING_HOOKS_LOG` default to off). Fixes land in the plugin (wordlists, `detection/`, `hooks/`), then the next audit's log confirms or refutes them.

## Corpora and Verdicts

Each rule is judged on the surface where the hook fires it: chat-surface rules against the user's chat, deliverable-surface rules (`flowery-phrases.txt`, `soft-phrasing.txt`) against the voice baseline. Lift gates new candidate phrases only (`--min-lift`, default 5.0, plus session count >= 3), never removals: the smoothed user baseline compresses lift for any word the user never types, which would flag the model's strongest tells for removal. Voice-delta features carry provenance labels (**skill-prescribed**, **skill-encouraged**, **ungoverned**) so drift points at the right fix, and they are aggregate trends only, never per-document flags.

[references/methodology.md](references/methodology.md) is the single home for the corpora, metrics, queries, per-surface reasoning, and tuning behind each report section and verdict.

## Workflow

Review the report. Edit `plugins/writing/wordlists/*.txt` by hand, then re-run to confirm. The skill never edits wordlists.

## Linguistics

See [references/linguistics.md](references/linguistics.md) for the part-of-speech tagger evaluation behind `scripts/headings-eval.ts`: classifier comparison, synthetic corpus generation, promotion criteria, and dependency earn/retire rules.
