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

Build the local voice baseline once (and refresh it as new writing accumulates). It is the comparison surface for deliverable-aware rule health. The baseline is local-only and never committed. It is stored in the plugin data directory (`CLAUDE_PLUGIN_DATA`, else `~/.claude/plugins/data/writing-bendrucker`).

```bash
# Seed from the already-present delimited corpus (no re-fetch needed)
bun ${CLAUDE_SKILL_DIR}/scripts/ingest-voice.ts --source file --file <data-dir>/voice-baseline/github-prs.txt
# Or fetch fresh merged PRs (designed to add more sources later)
bun ${CLAUDE_SKILL_DIR}/scripts/ingest-voice.ts --source github --author <user> --created 2019-01-01..2025-01-01
# Build the profile the audit reads
bun ${CLAUDE_SKILL_DIR}/scripts/voice-profile.ts
```

If no profile exists, analyze still runs: deliverable-surface rules fall back to the chat audit and the report flags the baseline as not loaded.

## Run

Pass the DB path via `--session-db`:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/analyze.ts --session-db "$DB_PATH"
bun ${CLAUDE_SKILL_DIR}/scripts/analyze.ts --session-db "$DB_PATH" --since 2026-04-01 --model '*opus*' --top 50
bun ${CLAUDE_SKILL_DIR}/scripts/analyze.ts --session-db "$DB_PATH" --project bendrucker.me --min-lift 7
```

Run with `--help` for all flags. `--data-dir` overrides where the voice baseline is read from (default: `CLAUDE_PLUGIN_DATA` or `~/.claude/plugins/data/writing-bendrucker`). Writes a markdown report to `tmp/trope-analysis-<date>.md` (override with `--out`). The report may quote any host in the combined index, so keep it under `tmp/` and never paste host-specific content into committed work.

## Metrics

**Lift**: how distinctive a phrase is to assistant output vs. user text. `lift = rate_assistant / rate_user_smoothed`, where rates are per-million-token frequencies. A lift of 10.0 means the assistant uses the phrase 10x more per token than the user. The `--min-lift` threshold (default 5.0) gates new candidate phrases only. Rule keep/remove uses a direct rate comparison plus `--min-count`, not lift (see methodology for why).

**Session count**: number of distinct sessions containing a phrase. Candidates require session count >= 3 to filter project-specific jargon that dominates a single session.

## Output

- Summary stats (corpus sizes, voice-baseline size, rule count, model breakdown)
- Proposed removals, each tagged **dead** (model produced it fewer than `--min-count` times on the surface where the hook fires it) or **not distinctive** (baseline uses it at least as often as the model)
- Proposed additions (high-lift n-grams not already covered), each with its voice-baseline rate and a spot-checkable quote
- Rule health table (every entry with type, audit surface, and `keep` / `remove (reason)`), plus deliverable quotes for the deliverable-surface tells
- Structural pattern audit (the hook's regex patterns, hit counts across sessions)
- Corrective feedback (short human messages naming a writing problem, with the preceding model output)
- Correction candidates (long-assistant, short-user pairs suggesting prose pushback)

Each rule is judged on the surface where the hook fires it. Chat-surface rules (openers, sycophantic patterns, conversational vocabulary) compare the model's chat against the user's chat. Deliverable-surface rules (`flowery-phrases.txt`, `soft-phrasing.txt`) compare the model's deliverable prose against the user's voice baseline, so a tell frequent in PR bodies and absent from the baseline reads as **keep**, not dead. A rule the model uses far more than the baseline is kept even when its lift reads low. Lift is not used for removal decisions because the smoothed user baseline (see methodology) compresses it for any word the user never types, which would flag the model's strongest tells (`delve`, `comprehensive`, `robust`) for removal.

## Corpora

Four corpora, each serving a different purpose:

- **All model-generated text**: conversational assistant text (`text-export`, role=assistant) combined with deliverable prose (`deliverable-prose.sql`). The session DB's `text_content` view only captures conversational text blocks, not tool inputs (Write/Edit/Bash). The deliverable query fills this gap. The combined corpus is used for n-gram candidates.
- **Deliverable prose** (`deliverable-prose.sql`): Write/Edit to prose files, Bash commands with `--body`/`--message`/`-m`. The candidate-mining corpus and the model side of the deliverable-aware rule audit.
- **Human-only user text** (`text-export`, role=user, filtered): the baseline for lift calculation. Filters out system-injected content (skill injections, context compaction summaries, task notifications, system reminders) and pasted model output (see methodology) that arrives as user-role messages but is machine-generated.
- **Voice baseline** (local-only, `voice-profile.ts`): the user's hand-written, pre-AI pull requests. The baseline side of the deliverable-aware rule audit and the "absent from my baseline" signal for additions.

The FTS rule health audit uses `text_content` (a view covering both roles) with its own FTS indexes for chat-surface rules. Deliverable-surface rules compare deliverable prose against the voice baseline.

## Workflow

Review the report. Edit `plugins/writing/wordlists/*.txt` by hand, then re-run to confirm. The skill never edits wordlists itself.

## Methodology

See [references/methodology.md](references/methodology.md) for query details, known gaps, and tuning guidance.

See [references/linguistics.md](references/linguistics.md) for the POS tagger evaluation behind `scripts/headings-eval.ts`: classifier comparison, synthetic corpus generation, promotion criteria, and dependency earn/retire rules.
