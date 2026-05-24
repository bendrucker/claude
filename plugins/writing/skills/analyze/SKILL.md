---
name: writing:analyze
description: >-
  Curate the writing plugin's trope ruleset: audit existing wordlist entries
  against recent session history, surface candidate phrases worth adding, and
  produce a triage report covering both additions and removals. Use when
  refreshing the writing plugin's trope detection based on recent session
  activity.
allowed-tools:
  - Bash
  - Read
---

# Writing analyze

Curate the writing plugin's AI-trope ruleset, additions and removals as parallel outcomes. The skill mines the local session DuckDB index for what the assistant actually wrote in the last N days, compares it against the user's own voice, and proposes a diff against `plugins/writing/wordlists/*.txt`.

## Prerequisites

- Session plugin's `text_content` view and trope-analysis queries (`text-export`, `phrase-lift`, `correction-candidates`, `model-summary`) must be available. These ship in PR #636 of the claude config repo.
- Wordlists at `plugins/writing/wordlists/` are optional; if missing, the skill skips the audit and still surfaces additions.

## Run

```bash
${CLAUDE_SKILL_DIR}/scripts/analyze.ts
${CLAUDE_SKILL_DIR}/scripts/analyze.ts --since 2026-04-01 --model '*opus*' --top 50
${CLAUDE_SKILL_DIR}/scripts/analyze.ts --project bendrucker.me --min-lift 7
```

Flags: `--since`, `--until`, `--model`, `--project`, `--min-lift`, `--top`, `--out`, `--session-query`, `--wordlists-dir`, `--corrections-limit`. Run with `--help` for defaults.

The script writes a markdown report to `tmp/trope-analysis-<date>.md` (override with `--out`) and prints the path on stdout. Stderr carries progress for ad-hoc runs.

## What it produces

Each pass writes a section. Removals and additions are co-equal top-level sections, since the value of curation is keeping the ruleset sharp in both directions.

- Summary stats (corpus sizes, rule count, proposed-change counts, model breakdown)
- Proposed wordlist removals (rules whose lift collapsed below `--min-lift`)
- Proposed wordlist additions (high-lift n-grams not already covered)
- Current rule health table (every entry, with status `keep` / `remove` / `no data`)
- Correction candidates (long-assistant / short-user pairs to scan for prose pushback)

Both removal and addition sections include a copy-pasteable `diff`-style block keyed to the source wordlist file.

## Workflow

Review the report. Promote findings into wordlists by editing `plugins/writing/wordlists/*.txt` by hand, then re-run to confirm the ruleset is sharp. The skill never edits wordlists itself.

## Methodology

See [references/methodology.md](references/methodology.md) for what each pass queries and how to interpret the numbers.
