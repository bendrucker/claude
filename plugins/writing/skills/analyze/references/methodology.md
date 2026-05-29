# Methodology

How each pass of `analyze.ts` works and how to read the report.

## Dependencies

The analyze script opens the session DuckDB database directly via `@duckdb/node-api`. The DB path is passed via `--session-db`. The session skill's refresh script must run first to ensure the index is current. All SQL queries live in `resources/queries/` within the analyze skill.

## Refresh

The agent runs the session skill's `refresh.ts --refresh` before invoking analyze. This forces a rescan of `~/.claude/projects/**/*.jsonl`. The refresh script prints the DB path to stdout, which the agent captures and passes as `--session-db`.

## Metrics

#### Lift

Lift measures how distinctive a phrase is to assistant output compared to the user's voice. Borrowed from association rule mining:

```
lift = rate_assistant / rate_user_smoothed
```

Where rates are per-million-token frequencies and the user rate uses Laplace smoothing (`+1 pseudo-count`) to avoid division by zero for phrases absent from user text.

- `lift = 1.0` means the phrase appears at equal rates in both corpora.
- `lift = 10.0` means the assistant uses the phrase 10x more often per token than the user.

The `--min-lift` threshold (default 5.0) gates new candidate phrases. It does **not** decide rule keep/remove (see "Audit Current Wordlists" for why lift is unreliable there).

#### Session count

The number of distinct sessions in which a phrase appears. Filters project-specific jargon that dominates a single long session but doesn't represent a model-wide habit. Candidates require a session count of 3+ to be surfaced.

## FTS Setup

Installs DuckDB's FTS extension and materializes per-role corpus tables (`fts_assistant_corpus`, `fts_user_corpus`) from `text_content`, filtered by date, model, project, and minimum length. Creates Porter-stemmed FTS indexes with English stopwords. These ephemeral tables are cleaned up in a `finally` block.

## Audit Current Wordlists

Wordlist entries are batch-audited via `fts-phrase-audit.sql`. The query stems each entry with Porter stemming, then looks up term frequencies in both FTS indexes. Returns per-term assistant/user counts, per-million rates, and lift.

A rule is **kept** when the model uses it strictly more per token than the user (`assistant_per_m > user_per_m`) and it appears at least `--min-count` times (default 5). Otherwise the report proposes removal with one of two reasons:

- **dead**: fewer than `--min-count` assistant occurrences. The rule rarely fires regardless of distinctiveness.
- **not distinctive**: the user uses it at least as often per token. The rule would flag the user's own voice.

Removal does **not** use lift. The user baseline is small (often tens of thousands of tokens, even with cross-machine history merged in), so the Laplace smoothing floor (`1/user_total`) dominates: any word the user never types needs a high per-million rate in assistant text just to reach a lift of 5.0. That gate is nearly unreachable for single words, so a pure lift threshold flags the model's strongest surviving tells (`delve`, `comprehensive`, `robust`) for removal. The direct rate comparison is smoothing-free and keeps them.

The audit measures each term in `text_content` (conversational assistant and user text). This is a proxy surface: most wordlist rules fire on deliverables and side-effect inputs, not chat, but the model's chat usage of a term tracks its overall habit closely enough to judge distinctiveness. A consequence: a term both the model and the user say conversationally (`Perfect` as an acknowledgment) reads as not distinctive and is dropped even if it might still open a deliverable.

The proxy breaks entirely for tells that live *only* in deliverables and never in chat. The flowery phrases (`flowery-phrases.txt`) and the soft group (`soft-phrasing.txt`) were curated from PR-body evidence, so the chat-surface audit reports them as `dead` (zero chat hits) or as `not distinctive`. Those verdicts are not authoritative for deliverable-surface rules. Auditing wordlist health against the deliverable corpus directly (not just chat) is the fix, tracked with the rest of the deliverable-aware analyze work.

Because removed single words are no longer in the wordlist, a later audit cannot resurface them (the additions pipeline only mines multi-word n-grams). If the model regresses to a removed word, add it back by hand.

## Surface Candidate Phrases

Pulls two corpora:

- **Deliverable prose** (`deliverable-prose.sql`): the model's file writes (`.md`/`.txt`/`.rst`/`.adoc`) and Bash commit/PR/MR bodies. This is the n-gram candidate corpus, because these are the surfaces the hook scans. Conversational assistant text is deliberately excluded: the hook never sees the model's chat, so mining it floods the candidate list with narration (`now let me`, `let me check`) at enormous lift that no rule can act on. Scoping to deliverables surfaces only phrasing that could become an enforceable rule.
- **Human-only user text** (`text-export` with `role=user`, filtered): the baseline for lift. The human doesn't write via Write/Edit, so this is their chat voice; lift therefore contrasts the model's deliverable phrasing against the human's natural voice. Excludes system-injected user-role content: skill injections, context compaction summaries, task notifications, system reminders, and CLAUDE.md context.

The n-gram code in `ngram.ts` strips markdown/code artifacts, URLs, table lines, headers, and code-shaped identifiers from both corpora.

For each cleaned sentence, accumulates 3- and 4-gram counts. Builds rows with assistant count, user count, per-million-token rates, and lift. Excludes phrases already covered by the wordlists (substring match). Filters to `lift >= --min-lift` and `session count >= 3`, then returns the top N.

Minimum assistant counts per n-gram size (3-grams: 5, 4-grams: 3) are hardcoded to suppress noise.

#### Deliverable prose

The `deliverable-prose.sql` query extracts text from Write/Edit to prose files (`.md`, `.txt`, `.rst`, `.adoc`) and Bash commands with `--body`/`--message`/`--description`/`--title`/`-m`. It excludes paths the hook skips (memory, plan, wordlist files). For Bash, it extracts heredoc content and quoted flag values via regex. This is the corpus the n-gram candidate miner runs on (see above); the all-assistant `text-export` corpus is still pulled for the structural audit and summary sizing.

#### User text filtering

User-role messages in Claude Code contain a mix of human input and machine-generated content. The `text_content` view classifies these with two boolean columns:

- `is_subagent`: `source_file` contains `/subagents/` (subagent prompts, task dispatches)
- `is_system`: prefix-based heuristics for system-injected content

The `is_system` patterns cover:

- XML-tagged injections (`<task-notification>`, `<command-name>`, `<system-reminder>`, etc.)
- Context compaction summaries (`This session is being continued from a previous conversation`)
- Plan injections (`Implement the following plan:`)
- Interruption markers (`[Request interrupted by user]`)
- Ultraplan/ultrareview UI (`◇ `, `◆ `, `Ultraplan `)
- Goal injections (`Goal set:`)

Skill injections and hook feedback are excluded earlier by `is_meta=true` in the WHERE clause (787+ messages in a typical 30-day window).

Without this filtering, roughly half the user corpus by character count is machine-generated, which inflates the baseline and suppresses real lift signals.

## Structural Pattern Audit

`structural.ts` imports the hook's `PATTERNS` directly from `hooks/tropes.ts` rather than re-declaring them, so the audit cannot drift from what the hook enforces. It keeps only the regex patterns whose source is not a wordlist (stemmed vocabulary and weighted verbs are covered by the FTS pass; `WORDLISTS.openers` is too) and normalizes each to the global flag for accurate counting. Function-based tests (e.g. test-result reporting) are excluded because they cannot be counted by a single regex match.

The patterns run against all assistant text (not just deliverables). Each reports total hits, number of rows containing hits, and session spread. Patterns are labeled by their hook scope (all, file-only, side-effect-only).

This catches structural tropes (semicolons, passive voice, hedging, parallelism) that the n-gram pipeline cannot detect.

## Rule health table

#### Type column

Each rule in the health table is labeled by how the hook enforces it:

- **vocabulary**: stemmed word match, fires on all prose (file writes, Bash args, MCP inputs)
- **opener**: sideEffectOnly pattern, fires only on Bash/MCP inputs (not file writes)
- **weighted**: accumulates a weighted score across matches, fires at a threshold

## Surface Corrections

Runs `correction-candidates` with `min_assistant_chars=300`, `max_user_chars=250`, `limit=--corrections-limit`. The query finds adjacent message pairs where a long assistant message is followed by a short user reply. Short replies often indicate corrections or pushback.

## Spot-checking with DuckDB sampling

When auditing corpus quality (verifying `is_system`/`is_subagent` classification, checking for pasted machine content in user text), use DuckDB's `USING SAMPLE` clause for stratified random sampling across sessions:

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

`USING SAMPLE reservoir(N ROWS) REPEATABLE(seed)` gives deterministic reservoir sampling. The sample size and seed must be integer literals (expressions and `getvariable()` are not supported in the `SAMPLE` clause). To vary sample sizes, edit the query inline rather than parameterizing.

Stratify by sampling sessions first, then rows within those sessions. Without the session pool step, high-volume sessions dominate the sample and patterns from quieter sessions go unexamined.

## Tuning

Raise `--min-lift` (default 5.0) if the candidate list is too noisy. Lower it if too quiet. Raise `--min-count` (default 5) to be stricter about what counts as a live rule (more removals tagged dead); lower it to keep rarer rules. N-grams larger than 4 tokens are not currently considered.
