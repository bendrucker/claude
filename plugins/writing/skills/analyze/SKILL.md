---
name: writing:analyze
description: >-
  Curate the writing plugin's trope ruleset by auditing wordlist entries against
  session history and surfacing candidate phrases. Use when refreshing trope
  detection, reviewing wordlist health, or mining sessions for new AI-writing
  patterns to add or stale rules to remove.
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Skill(claude-code:session)
---

# Writing Analyze

Mine the session DuckDB index for assistant writing patterns, compare against the user's voice, and propose a diff to `plugins/writing/wordlists/*.txt`.

## Prerequisites

Activate the `claude-code:session` skill first. Run its refresh script to ensure the index is current and capture the DB path:

```bash
DB_PATH=$(<session-skill-dir>/scripts/refresh.ts --refresh)
```

The refresh script prints the resolved DB path to stdout.

## Run

Pass the DB path via `--session-db`:

```bash
${CLAUDE_SKILL_DIR}/scripts/analyze.ts --session-db "$DB_PATH"
${CLAUDE_SKILL_DIR}/scripts/analyze.ts --session-db "$DB_PATH" --since 2026-04-01 --model '*opus*' --top 50
${CLAUDE_SKILL_DIR}/scripts/analyze.ts --session-db "$DB_PATH" --project bendrucker.me --min-lift 7
```

Run with `--help` for all flags. Writes a markdown report to `tmp/trope-analysis-<date>.md` (override with `--out`).

## Metrics

**Lift**: how distinctive a phrase is to assistant output vs. user text. `lift = rate_assistant / rate_user_smoothed`, where rates are per-million-token frequencies. A lift of 10.0 means the assistant uses the phrase 10x more per token than the user. The `--min-lift` threshold (default 5.0) gates new candidate phrases only. Rule keep/remove uses a direct rate comparison plus `--min-count`, not lift (see methodology for why).

**Session count**: number of distinct sessions containing a phrase. Candidates require session count >= 3 to filter project-specific jargon that dominates a single session.

## Output

- Summary stats (corpus sizes, rule count, model breakdown)
- Proposed removals, each tagged **dead** (model produced it fewer than `--min-count` times) or **not distinctive** (user uses it at least as often as the model)
- Proposed additions (high-lift n-grams not already covered)
- Rule health table (every entry with type and `keep` / `remove (reason)`)
- Structural pattern audit (the hook's regex patterns, hit counts across sessions)
- Correction candidates (long-assistant, short-user pairs suggesting prose pushback)

A rule the model uses far more than the user is **kept** even when its lift reads low. Lift is not used for removal decisions because the smoothed user baseline (see methodology) compresses it for any word the user never types, which would flag the model's strongest tells (`delve`, `comprehensive`, `robust`) for removal.

## Corpora

Three corpora, each serving a different purpose:

- **All model-generated text**: conversational assistant text (`text-export`, role=assistant) combined with deliverable prose (`deliverable-prose.sql`). The session DB's `text_content` view only captures conversational text blocks, not tool inputs (Write/Edit/Bash). The deliverable query fills this gap. The combined corpus is used for n-gram candidates.
- **Deliverable prose** (`deliverable-prose.sql`): Write/Edit to prose files, Bash commands with `--body`/`--message`/`-m`. Reported in the summary for context.
- **Human-only user text** (`text-export`, role=user, filtered): the baseline for lift calculation. Filters out system-injected content (skill injections, context compaction summaries, task notifications, system reminders) that arrives as user-role messages but is machine-generated.

The FTS rule health audit uses `text_content` (a view covering both roles) with its own FTS indexes.

## Workflow

Review the report. Edit `plugins/writing/wordlists/*.txt` by hand, then re-run to confirm. The skill never edits wordlists itself.

## Methodology

See [references/methodology.md](references/methodology.md) for query details, known gaps, and tuning guidance.
