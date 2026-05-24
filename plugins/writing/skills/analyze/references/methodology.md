# Methodology

What each pass of `analyze.ts` does, what it queries, and how to read the report.

## Refresh

Calls the session plugin's `query.ts schema --refresh` to force a rescan of `~/.claude/projects/**/*.jsonl`. Subsequent queries see the latest data. This is a no-op when the index is current.

## Audit current wordlists

For every phrase in `plugins/writing/wordlists/*.txt`, runs the `phrase-lift` named query. That query returns per-role and per-model counts, total chars, per-1M-char rate, and a lift ratio (assistant per-1M / user per-1M).

The aggregated lift is computed in TypeScript: assistant counts across all models summed, divided by total assistant chars, normalized per million. Same for user. The ratio is the lift.

A phrase with `lift >= --min-lift` is "still distinctive", so the rule stays. Below that, propose removal.

`phrase-lift` matches case-insensitively but otherwise as a literal substring, so multi-word entries like `let me check` match exactly that order.

## Surface candidate phrases

Runs `text-export` twice (once for assistants matching `--model`, once for users) to pull raw prose from `text_content`. That view strips fenced code and inline backticks; the local n-gram code in `ngram.ts` does a second pass to strip URLs, table lines, headers, code-shaped identifiers, and CLI flags.

For each cleaned sentence, accumulates 2-, 3-, and 4-gram counts. Builds rows with assistant count, user count, per-million-token rates, and lift. Excludes any phrase already covered by the wordlists (substring match). Filters to `lift >= --min-lift`. Returns the top N.

Minimum assistant counts per n-gram size are hardcoded (2-grams: 8, 3-grams: 5, 4-grams: 3) to keep noise out without exposing too many tuning knobs.

## Surface corrections

Runs `correction-candidates` with `min_assistant_chars=300`, `max_user_chars=250`, `limit=--corrections-limit`. The query finds adjacent message pairs in the same session where a long assistant message is followed by a short user reply, on the heuristic that short replies are corrections or pushback.

The report includes both snippets so a human can scan for prose pushback the assistant might have missed.

## Report

Markdown to `tmp/trope-analysis-<date>.md`. The structure mirrors the passes:

- Summary block with corpus sizes, rule count, proposed-change counts, model breakdown table.
- Proposed wordlist removals (collapsed rules), with a copy-pasteable diff block grouped by source file.
- Proposed wordlist additions (new candidates), same shape.
- Current rule health, the full audit table with status per entry.
- Correction candidates with full snippets, most recent first.

No automatic edits. The diff blocks are intentionally inert. Promote findings into the wordlists by hand, then re-run.

## Tuning

If the report is too noisy, raise `--min-lift` (default 5.0). If too quiet, lower it. If a known trope isn't surfacing, check whether it's an n-gram larger than 4 tokens (those aren't currently considered).

The skill is single-host. Cross-machine analysis requires the session plugin's cross-machine work to land first.
