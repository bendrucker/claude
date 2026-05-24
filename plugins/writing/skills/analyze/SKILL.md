---
name: writing:analyze
description: >-
  Curate the writing plugin's trope ruleset by auditing wordlist entries against
  session history and surfacing candidate phrases. Use when refreshing trope
  detection, reviewing wordlist health, or mining sessions for new AI-writing
  patterns to add or stale rules to remove.
allowed-tools:
  - Bash
  - Read
---

# Writing Analyze

Mine the session DuckDB index for assistant writing patterns, compare against the user's voice, and propose a diff to `plugins/writing/wordlists/*.txt`.

## Run

```bash
${CLAUDE_SKILL_DIR}/scripts/analyze.ts
${CLAUDE_SKILL_DIR}/scripts/analyze.ts --since 2026-04-01 --model '*opus*' --top 50
${CLAUDE_SKILL_DIR}/scripts/analyze.ts --project bendrucker.me --min-lift 7
```

Run with `--help` for all flags. Writes a markdown report to `tmp/trope-analysis-<date>.md` (override with `--out`).

## Output

- Summary stats (corpus sizes, rule count, model breakdown)
- Proposed removals (rules whose lift collapsed below `--min-lift`)
- Proposed additions (high-lift n-grams not already covered)
- Rule health table (every entry with `keep` / `remove` / `no data`)
- Correction candidates (long-assistant, short-user pairs suggesting prose pushback)

## Workflow

Review the report. Edit `plugins/writing/wordlists/*.txt` by hand, then re-run to confirm. The skill never edits wordlists itself.

## Methodology

See [references/methodology.md](references/methodology.md) for query details and tuning guidance.
