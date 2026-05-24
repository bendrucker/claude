# Methodology

How each pass of `analyze.ts` works and how to read the report.

## Refresh

Calls `query.ts schema --refresh` to force a rescan of `~/.claude/projects/**/*.jsonl`. Subsequent queries see the latest data.

## Audit Current Wordlists

For every phrase in `plugins/writing/wordlists/*.txt`, runs the `phrase-lift` named query. That query returns per-role and per-model counts, total chars, per-1M-char rate, and a lift ratio (assistant rate / user rate).

Aggregated lift is computed in TypeScript: assistant counts across all models summed, divided by total assistant chars, normalized per million. Same for user. The ratio is the lift.

A phrase with `lift >= --min-lift` keeps its rule. Below that threshold, the report proposes removal.

`phrase-lift` matches case-insensitively as a literal substring, so multi-word entries like `let me check` match that exact token order.

## Surface Candidate Phrases

Runs `text-export` twice (assistant matching `--model`, user) to pull prose from `text_content`. That view strips fenced code and inline backticks. The local n-gram code in `ngram.ts` does a second pass to strip URLs, table lines, headers, code-shaped identifiers, and CLI flags.

For each cleaned sentence, accumulates 2-, 3-, and 4-gram counts. Builds rows with assistant count, user count, per-million-token rates, and lift. Excludes phrases already covered by the wordlists (substring match). Filters to `lift >= --min-lift` and returns the top N.

Minimum assistant counts per n-gram size (2-grams: 8, 3-grams: 5, 4-grams: 3) are hardcoded to suppress noise.

## Surface Corrections

Runs `correction-candidates` with `min_assistant_chars=300`, `max_user_chars=250`, `limit=--corrections-limit`. The query finds adjacent message pairs where a long assistant message is followed by a short user reply. Short replies often indicate corrections or pushback.

The report includes both snippets for manual review.

## Report

Markdown written to `tmp/trope-analysis-<date>.md`:

- Summary block with corpus sizes, rule count, proposed-change counts, model breakdown table
- Proposed removals (collapsed rules) with a copy-pasteable diff block grouped by source file
- Proposed additions (new candidates), same format
- Full rule health audit table with status per entry
- Correction candidates with snippets, most recent first

The diff blocks are inert. Promote findings into wordlists by hand, then re-run.

## Tuning

Raise `--min-lift` (default 5.0) if the report is too noisy. Lower it if too quiet. N-grams larger than 4 tokens are not currently considered.

The skill is single-host. Cross-machine analysis requires the session plugin's cross-machine work to land first.
