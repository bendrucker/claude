# Methodology

How each pass of `analyze.ts` works and how to read the report.

## Dependencies

`analyze.ts` opens the session DuckDB database directly via `@duckdb/node-api`, reading the path from `--session-db`. SQL queries live in `resources/queries/`.

## Refresh

Run the session skill's `refresh.ts --refresh` before analyze. It rescans `~/.claude/projects/**/*.jsonl` and prints the DB path to stdout, which the agent passes as `--session-db`.

## Metrics

#### Lift

How distinctive a phrase is to assistant output versus the user's voice, borrowed from association rule mining:

```
lift = rate_assistant / rate_user_smoothed
```

Rates are per-million-token frequencies; the user rate uses Laplace smoothing (`+1 pseudo-count`) to avoid dividing by zero for phrases absent from user text. A lift of 1.0 means equal rates; 10.0 means the assistant uses the phrase 10x more often per token.

The `--min-lift` threshold (default 5.0) gates new candidate phrases. It does **not** decide rule keep/remove (see "Audit current wordlists" for why lift is unreliable there).

#### Session count

Distinct sessions containing a phrase. Filters project-specific jargon that dominates a single long session without representing a model-wide habit. Candidates require a session count of 3+.

## FTS setup

Installs DuckDB's FTS extension and materializes per-role corpus tables (`fts_assistant_corpus`, `fts_user_corpus`) from `text_content`, filtered by date, model, project, and minimum length. Creates Porter-stemmed FTS indexes with English stopwords. These ephemeral tables are cleaned up in a `finally` block.

## Audit current wordlists

`fts-phrase-audit.sql` batch-audits wordlist entries: it Porter-stems each entry, looks up term frequencies in both FTS indexes, and returns per-term assistant/user counts, per-million rates, and lift.

A rule is **kept** when the model uses it strictly more per token than the comparison baseline (`model_per_m > baseline_per_m`) and it appears at least `--min-count` times (default 5) on its firing surface. Otherwise the report proposes removal with one of two reasons:

- **dead**: fewer than `--min-count` model occurrences on the firing surface. The rule rarely fires regardless of distinctiveness.
- **not distinctive**: the baseline uses it at least as often per token. The rule would flag the user's own voice.

Removal does **not** use lift. The user baseline is small (often tens of thousands of tokens, even with cross-machine history merged in), so the Laplace smoothing floor (`1/user_total`) dominates: any word the user never types needs a high per-million rate in assistant text just to reach a lift of 5.0. That gate is nearly unreachable for single words, so a pure lift threshold would flag the model's strongest surviving tells (`delve`, `comprehensive`, `robust`) for removal. The direct rate comparison is smoothing-free and keeps them.

#### Per-surface auditing

Each rule is judged on the surface where the hook fires it, so the audit measures the rule against the corpus it actually polices.

- **Chat-surface rules** (`openers.txt`, the conversational vocabulary, the sycophantic patterns) compare the model's chat assistant text against the user's chat text in `text_content`, via the FTS pass. The model's chat usage of these terms tracks its overall habit. A consequence: a term both the model and the user say conversationally (`Perfect` as an acknowledgment) reads as not distinctive and is dropped even if it might still open a deliverable.
- **Deliverable-surface rules** (`flowery-phrases.txt` and `soft-phrasing.txt`, both `fileOnly` in the hook) compare the model's deliverable-prose rate against the user's voice-baseline rate. Each entry is stem-matched against the deliverable corpus (the same Porter-stemmed subsequence scan the hook uses) and looked up in the voice profile (`voice-profile.ts`). A phrase frequent in the model's PR bodies and absent from the user's hand-written baseline reads as **keep**, which is the correct verdict: `source of truth`, `escape hatch`, `self-sufficient`, and `fail loudly` each occur dozens of times in deliverable prose and zero times across the 209 pre-AI baseline PRs.

`marketing-verbs.txt` stays on the chat audit even though it reads as deliverable phrasing: its hook group is not `fileOnly`, so it fires on Bash side-effect inputs too, and auditing it against deliverables alone undercounts it (the few deliverable hits are often the user's own meta-discussion of the wordlist file). See `deliverable-audit.ts` for the surface assignment.

When no voice profile is loaded, deliverable-surface rules are still measured on the deliverable corpus, not the chat audit. The chat audit cannot score them: it stems each entry and joins against single-word FTS tokens, so a multi-word phrase never matches and would read as a false `dead`. Without a baseline the distinctiveness check is skipped, so an alive rule is reported `keep (no baseline)` rather than proposed for removal. Build the baseline with `ingest-voice.ts` then `voice-profile.ts` (see "Voice baseline") for the full deliverable-aware verdicts.

Because removed single words are no longer in the wordlist, a later audit cannot resurface them (the additions pipeline only mines multi-word n-grams). If the model regresses to a removed word, add it back by hand.

## Voice baseline

The user's true deliverable voice is their hand-written, pre-AI pull requests, not their chat. A tell is real if it is frequent in the model's deliverables and absent from this baseline. The baseline is **local-only and never committed**, since it will grow to include private writing. It is stored in the plugin data directory (`CLAUDE_PLUGIN_DATA`, else `~/.claude/plugins/data/writing-bendrucker`), resolved by `data-dir.ts`.

#### Ingesting sources

`ingest-voice.ts` normalizes one or more document sources into `voice-baseline/github-prs.txt`, a delimited corpus (`===== <source> (<meta>) =====` per document). Two sources:

- **github**: `gh search prs --author=<user> --merged --json url,body,createdAt`, optionally scoped with `--created`. Designed to add more sources later.
- **file**: merges an existing delimited corpus (the already-present seed) so the 209-PR baseline does not need re-fetching.

Merging de-duplicates by source pointer, so re-ingesting a range is idempotent.

#### Building the profile

`voice-profile.ts` reads the corpus and writes `voice-baseline/profile.json`: unigram, bigram, and trigram word n-gram counts plus the total token count, built with the same tokenizer (`ngram.ts`) the candidate miner uses. `phraseProfileStat` looks a phrase up in the profile, and phrases longer than a trigram match by their leading trigram. A count of 0 is the strongest "absent from my baseline" signal.

Both the corpus and the profile stay in the local data dir. `analyze.ts` loads the profile read-only via `--data-dir`. Nothing baseline-derived is ever written into the repository.

## Corrective feedback

`corrective-feedback.sql` surfaces labeled-slop moments: short, human-authored user messages matching a frustration lexicon (`frustration.ts`: `wtf`, `ugh`, `flowery`, `verbose`, `cut the`, `reads like`, and similar), paired with the preceding model output. These are higher-signal than the inferred long-assistant/short-user candidates because the user named a writing problem directly. The lexicon compiles to a boundary-anchored regex alternation passed as the `lexicon` variable. Pasted model output is excluded by the same `is_system`/`is_subagent` flags and length ceiling used elsewhere.

## Quote in context

Every candidate phrase and audited deliverable-surface tell ships with a context window and source pointer (`quote-context.ts`), so a curation decision is spot-checkable without a separate query. `deliverable-prose.sql` carries `source_file`, `source_line`, and the written `file_path`. `findQuote` locates the first occurrence (exact for n-gram candidates, stemmed fallback for inflected tells) and returns a trimmed window plus the pointer. Quotes can reflect any host in the combined index, so they appear only in the local report under `tmp/`, never in committed content.

## Surface candidate phrases

Pulls two corpora:

- **Deliverable prose** (`deliverable-prose.sql`): the model's file writes (`.md`/`.txt`/`.rst`/`.adoc`) and Bash commit/PR/MR bodies, the surfaces the hook scans. Conversational assistant text is excluded: the hook never sees the model's chat, so mining it floods the candidate list with narration (`now let me`, `let me check`) at enormous lift that no rule can act on.
- **Human-only user text** (`text-export` with `role=user`, filtered): the baseline for lift. The human doesn't write via Write/Edit, so this is their chat voice, contrasting the model's deliverable phrasing against the human's natural voice. Excludes system-injected user-role content (see "User text filtering").

`ngram.ts` strips markdown/code artifacts, URLs, table lines, headers, and code-shaped identifiers from both corpora, then accumulates 3- and 4-gram counts per cleaned sentence. It builds rows with assistant count, user count, per-million-token rates, and lift, excludes phrases already covered by the wordlists (substring match), filters to `lift >= --min-lift` and `session count >= 3`, and returns the top N. Minimum assistant counts per n-gram size (3-grams: 5, 4-grams: 3) are hardcoded to suppress noise.

#### Deliverable prose

`deliverable-prose.sql` extracts text from Write/Edit to prose files (`.md`, `.txt`, `.rst`, `.adoc`) and Bash commands with `--body`/`--message`/`--description`/`--title`/`-m`, pulling heredoc content and quoted flag values via regex. It excludes paths the hook skips (memory, plan, wordlist files). The all-assistant `text-export` corpus is still pulled for the structural audit and summary sizing.

#### User text filtering

User-role messages in Claude Code contain a mix of human input and machine-generated content. The `text_content` view classifies these with two boolean columns:

- `is_subagent`: `source_file` contains `/subagents/` (subagent prompts, task dispatches)
- `is_system`: prefix-based heuristics covering XML-tagged injections (`<task-notification>`, `<command-name>`, `<system-reminder>`), context compaction summaries (`This session is being continued from a previous conversation`), plan injections (`Implement the following plan:`), interruption markers (`[Request interrupted by user]`), ultraplan/ultrareview UI (`◇ `, `◆ `, `Ultraplan `), and goal injections (`Goal set:`)

Skill injections and hook feedback are excluded earlier by `is_meta=true` in the WHERE clause. Without this filtering, roughly half the user corpus by character count is machine-generated, inflating the baseline and suppressing real lift signals.

## Structural pattern audit

`structural.ts` imports the hook's `PATTERNS` directly from `hooks/tropes.ts` rather than re-declaring them, so the audit cannot drift from what the hook enforces. It keeps only the regex patterns whose source is not a wordlist (the FTS pass covers stemmed vocabulary, weighted verbs, and `WORDLISTS.openers`) and normalizes each to the global flag for counting. Function-based tests (e.g. test-result reporting) are excluded because a single regex match cannot count them.

The patterns run against all assistant text (not just deliverables). Each reports total hits, rows containing hits, and session spread, labeled by hook scope (all, file-only, side-effect-only). This catches structural tropes (passive voice, hedging, parallelism) that the n-gram pipeline cannot detect.

## Structural Signatures

`pos-ngram.ts` is the word-independent analogue of the n-gram candidate miner. Each sentence in the deliverable corpus and the human user corpus is tagged with the `compromise` adapter from `plugins/writing/linguistics/`, mapped to coarse tags, and the tag sequences (3- to 5-grams like `COPULA PARTICIPLE ADP`) run through the same lift math as word n-grams.

The motivation: vocabulary tells drift with model releases, so wordlists need constant re-curation. The structural shape of a habit (passive voice, "not X but Y" parallelism, negated appositives, participial openers) persists across that drift. A high-lift tag sequence is a candidate for a structural rule that no vocabulary change invalidates.

Tag sequences draw from an alphabet of ~17 tags, so they are far denser than word n-grams: the per-size count floors are higher (3-grams: 30, 4-grams: 15, 5-grams: 8), the lift threshold is lower (`--pos-min-lift`, default 2.0, vs 5.0 for words), and most grammar is shared between the corpora so lift hovers near 1.0 for ordinary shapes.

Each surfaced shape carries its shortest corpus example sentence. Examples are verbatim corpus text: the report is local-only, and any shape quoted elsewhere needs an invented example.

Each rule is labeled in the **type** column by how the hook enforces it:

- **vocabulary**: stemmed word match, fires on all prose (file writes, Bash args, MCP inputs)
- **opener**: sideEffectOnly pattern, fires only on Bash/MCP inputs (not file writes)
- **weighted**: accumulates a weighted score across matches, fires at a threshold

## Surface corrections

Runs `correction-candidates` with `min_assistant_chars=300`, `max_user_chars=250`, `limit=--corrections-limit`. It finds adjacent pairs where a long assistant message is followed by a short user reply, which often indicates a correction or pushback.

## Spot-checking with DuckDB samples

When auditing corpus quality (verifying `is_system`/`is_subagent` classification, checking for pasted machine content), use DuckDB's `USING SAMPLE` clause for stratified random sampling across sessions:

```sql
-- Sample 20 sessions, then 40 rows within those sessions
WITH human AS (
  SELECT tc.*
  FROM text_content tc
  WHERE tc.role = 'user'
    AND NOT tc.is_subagent AND NOT tc.is_system
    AND length(tc.text) >= 30
),
session_pool AS (
  SELECT DISTINCT session_id
  FROM human
  USING SAMPLE reservoir(20 ROWS) REPEATABLE(42)
)
SELECT h.session_id, h.text
FROM human h
JOIN session_pool USING (session_id)
USING SAMPLE reservoir(40 ROWS) REPEATABLE(42)
ORDER BY h.session_id, h.timestamp
```

`USING SAMPLE reservoir(N ROWS) REPEATABLE(seed)` gives deterministic reservoir sampling. The size and seed must be integer literals (expressions and `getvariable()` are unsupported in the `SAMPLE` clause), so vary sample sizes by editing the query inline.

Sample sessions first, then rows within them. Without the session pool step, high-volume sessions dominate the sample and quieter sessions go unexamined.

## Tuning

Raise `--min-lift` (default 5.0) if the candidate list is too noisy. Lower it if too quiet. Raise `--min-count` (default 5) to be stricter about what counts as a live rule (more removals tagged dead); lower it to keep rarer rules. N-grams larger than 4 tokens are not currently considered.
