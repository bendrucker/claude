# Methodology

How each pass of `analyze.ts` works and how to read the report.

## Dependencies

The analyze script delegates all DuckDB queries to the `claude-code:session` plugin's `query.ts` script, passed via `--session-query`. It never imports or resolves files from other plugins directly.

## Refresh

Calls `query.ts schema --refresh` to force a rescan of `~/.claude/projects/**/*.jsonl`. Subsequent queries see the latest data.

## Metrics

#### Lift

Lift measures how distinctive a phrase is to assistant output compared to the user's voice. Borrowed from association rule mining:

```
lift = rate_assistant / rate_user_smoothed
```

Where rates are per-million-token frequencies and the user rate uses Laplace smoothing (`+1 pseudo-count`) to avoid division by zero for phrases absent from user text.

- `lift = 1.0` means the phrase appears at equal rates in both corpora.
- `lift = 10.0` means the assistant uses the phrase 10x more often per token than the user.

The `--min-lift` threshold (default 5.0) decides both rule health (keep vs. remove) and new candidate inclusion.

#### Session count

The number of distinct sessions in which a phrase appears. Filters project-specific jargon that dominates a single long session but doesn't represent a model-wide habit. Candidates require a session count of 3+ to be surfaced.

## FTS Setup

Installs DuckDB's FTS extension and materializes per-role corpus tables (`fts_assistant_corpus`, `fts_user_corpus`) from `text_content`, filtered by date, model, project, and minimum length. Creates Porter-stemmed FTS indexes with English stopwords. These ephemeral tables are cleaned up in a `finally` block.

## Audit Current Wordlists

Wordlist entries are batch-audited via `fts-phrase-audit.sql`. The query stems each entry with Porter stemming, then looks up term frequencies in both FTS indexes. Returns per-term assistant/user counts, per-million rates, and lift.

A phrase with `lift >= --min-lift` keeps its rule. Below that threshold, the report proposes removal.

The audit uses `text_content` (all assistant text, including conversational messages) because wordlist rules fire on all prose surfaces, not just deliverables.

## Surface Candidate Phrases

Pulls two corpora:

- **All model-generated text**: conversational assistant text from `text-export` (filtered by `--model`) combined with deliverable prose from `deliverable-prose.sql`. The `text_content` view only captures `type='text'` content items (conversational output), not `type='tool_use'` (Write/Edit/Bash tool inputs). The deliverable-prose query fills this gap. The combined corpus is used for n-gram candidates. The structural pattern audit runs against conversational text only.
- **Human-only user text** (`text-export` with `role=user`, filtered): the baseline corpus for lift calculation. Excludes system-injected content that arrives as user-role messages: skill injections, context compaction summaries, task notifications, system reminders, and CLAUDE.md context.

The n-gram code in `ngram.ts` strips markdown/code artifacts, URLs, table lines, headers, and code-shaped identifiers from both corpora.

For each cleaned sentence, accumulates 3- and 4-gram counts. Builds rows with assistant count, user count, per-million-token rates, and lift. Excludes phrases already covered by the wordlists (substring match). Filters to `lift >= --min-lift` and `session count >= 3`, then returns the top N.

Minimum assistant counts per n-gram size (3-grams: 5, 4-grams: 3) are hardcoded to suppress noise.

#### Deliverable prose

The `deliverable-prose.sql` query extracts text from Write/Edit to prose files (`.md`, `.txt`, `.rst`, `.adoc`) and Bash commands with `--body`/`--message`/`--description`/`--title`/`-m`. It excludes paths the hook skips (memory, plan, wordlist files). For Bash, it extracts heredoc content and quoted flag values via regex. This corpus is reported in the summary for sizing context but is not used for n-gram candidates.

#### User text filtering

User-role messages in Claude Code contain a mix of human input and machine-generated content. The following are filtered out of the user baseline:

- Skill injections ("Base directory for this skill:")
- Context compaction summaries ("This session is being continued from a previous conversation")
- Task notifications (`<task-notification>`)
- Skill/command activations (`<command-name>`)
- System reminders (`<system-reminder>`)
- CLAUDE.md context injections (`# claudeMd`)
- Tool result echoes (`tool_use_id`)

Without this filtering, roughly half the user corpus by character count is machine-generated, which inflates the baseline and suppresses real lift signals.

## Structural Pattern Audit

Runs the regex-based patterns from `tropes.ts` against all assistant text (not just deliverables). Each pattern reports total hits, number of rows containing hits, and session spread. Patterns are labeled by their hook scope (all, file-only, side-effect-only).

This catches structural tropes (semicolons, passive voice, hedging, parallelism) that the n-gram pipeline cannot detect.

## Rule health table

#### Type column

Each rule in the health table is labeled by how the hook enforces it:

- **vocabulary**: stemmed word match, fires on all prose (file writes, Bash args, MCP inputs)
- **opener**: sideEffectOnly pattern, fires only on Bash/MCP inputs (not file writes)
- **weighted**: accumulates a weighted score across matches, fires at a threshold

## Surface Corrections

Runs `correction-candidates` with `min_assistant_chars=300`, `max_user_chars=250`, `limit=--corrections-limit`. The query finds adjacent message pairs where a long assistant message is followed by a short user reply. Short replies often indicate corrections or pushback.

## Tuning

Raise `--min-lift` (default 5.0) if the report is too noisy. Lower it if too quiet. N-grams larger than 4 tokens are not currently considered.
