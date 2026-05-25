# Methodology

How each pass of `analyze.ts` works and how to read the report.

## Dependencies

The analyze script delegates all DuckDB queries to the `claude-code:session` plugin's `query.ts` script, passed via `--session-query`. It never imports or resolves files from other plugins directly.

## Refresh

Calls `query.ts schema --refresh` to force a rescan of `~/.claude/projects/**/*.jsonl`. Subsequent queries see the latest data.

## FTS Setup

Installs DuckDB's FTS extension and materializes per-role corpus tables (`fts_assistant_corpus`, `fts_user_corpus`) from `text_content`, filtered by date, model, project, and minimum length. Creates Porter-stemmed FTS indexes with English stopwords. These ephemeral tables are cleaned up in a `finally` block.

## Audit Current Wordlists

Wordlist entries are batch-audited via `fts-phrase-audit.sql`. The query stems each entry with Porter stemming, then looks up term frequencies in both FTS indexes. Returns per-term assistant/user counts, per-million rates, and lift ratio.

A phrase with `lift >= --min-lift` keeps its rule. Below that threshold, the report proposes removal.

## Surface Candidate Phrases

Runs `text-export` twice (assistant matching `--model`, user) to pull prose from `text_content`. The local n-gram code in `ngram.ts` strips markdown/code artifacts, URLs, table lines, headers, and code-shaped identifiers.

For each cleaned sentence, accumulates 2-, 3-, and 4-gram counts. Builds rows with assistant count, user count, per-million-token rates, and lift. Excludes phrases already covered by the wordlists (substring match). Filters to `lift >= --min-lift` and returns the top N.

Minimum assistant counts per n-gram size (2-grams: 8, 3-grams: 5, 4-grams: 3) are hardcoded to suppress noise.

## Surface Corrections

Runs `correction-candidates` with `min_assistant_chars=300`, `max_user_chars=250`, `limit=--corrections-limit`. The query finds adjacent message pairs where a long assistant message is followed by a short user reply. Short replies often indicate corrections or pushback.

## Tuning

Raise `--min-lift` (default 5.0) if the report is too noisy. Lower it if too quiet. N-grams larger than 4 tokens are not currently considered.
