---
name: claude-code:session
description: Query Claude Code session history via a DuckDB index over `~/.claude/projects/`. Use when asked about Claude Code activity ("how many tokens today?", "what did I work on this week?") or instead of reading, grepping, or jq-ing session transcripts. Not for codebase search, git log queries, or arbitrary databases.
argument-hint: "[--refresh] [--host label] [--since date]"
allowed-tools:
  - Bash
  - Read
---

# Session

Search and analyze Claude Code conversation history via a DuckDB index over JSONL session files.

Current session ID: `${CLAUDE_SESSION_ID}`

## Arguments

Map any arguments to the mechanisms below:

- `--refresh`: force a rescan via `refresh.ts --refresh` before querying. Default: the incremental refresh described in [Refresh](#refresh).
- `--host <label>`: scope queries to one imported machine through the `host` param. Default: span every host, including `local`. See [Cross-Machine History](#cross-machine-history).
- `--since <date>`: pass as the `after_date` param to scope queries from that date forward. Default: the full index.

## Database

The session index is a DuckDB database at `${CLAUDE_PLUGIN_DATA}/session.duckdb`. That path is stable: use it directly in every query and agent prompt. `refresh.ts` prints the same path, resolved, for callers outside this skill.

### Refresh

Run `refresh.ts` before querying. It scans `~/.claude/projects/**/*.jsonl` plus any imported hosts, imports files whose mtime or size changed, drops rows for deleted files, and prints the DB path. When a prior refresh finished within `--max-age` (default 300 seconds), it prints the path and exits without opening the database, so calling it before every query is cheap. Pass `--refresh` to rescan regardless when the user asks for the latest data.

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/refresh.ts
```

### Querying

After refresh, query with the `duckdb` CLI or any DuckDB client, always `-readonly`. Querying never writes, and a read-write open would block refreshes and other readers. Named SQL files in `resources/queries/` provide common queries. Use `SET VARIABLE` for parameterization and `getvariable('key')` in SQL. Quote variable names that are reserved words: `SET VARIABLE limit = 5` is a parser error (`limit` is reserved), `SET VARIABLE "limit" = 5` works. `getvariable('limit')` is unaffected either way.

```bash
duckdb -readonly ${CLAUDE_PLUGIN_DATA}/session.duckdb "SELECT model, SUM(output_tokens) FROM message_usage GROUP BY model"
duckdb -readonly ${CLAUDE_PLUGIN_DATA}/session.duckdb < ${CLAUDE_SKILL_DIR}/resources/queries/stats.sql
```

`scripts/usage.ts` renders a session's token-burn timeline (`--session <id>`) in the terminal, or the top sessions by estimated cost (`--days <n>`) when no session is given. It opens the index read-only. Cost is an estimate from public API rates, useful as a relative weight rather than billed spend.

### Locking

DuckDB locks the database file per process. Read-only opens take a shared lock, and any number of them coexist. A write open (a refresh that has work to do) needs exclusive access. It cannot start while readers hold the file, and a reader cannot open mid-refresh. Either collision fails with `Could not set lock`. Retry after the other side finishes. `refresh.ts` retries briefly on its own, and when a concurrent refresh holds the lock it prints the path and exits 0, since the other run is doing the same work.

### Parallel Queries (Workflows)

For a fan-out of agents investigating the corpus, the orchestrator runs `refresh.ts --refresh` once up front, then every agent opens `${CLAUDE_PLUGIN_DATA}/session.duckdb` read-only. Never let a fanned-out agent call `refresh.ts`: past the stamp's `--max-age` it opens read-write and collides with every reader. Queries read a shared file, so the agents need no worktree. Worked example (param scoping via `SET VARIABLE`, breadth-first survey surfaces) in [`references/workflows.md`](references/workflows.md).

For self-improvement discovery (fanning out over the whole corpus to mine config-change candidates, then grounding them against the live config), [`references/discovery.md`](references/discovery.md) carries the full recipe.

## Named Queries

Built-in queries in `resources/queries/` run by name with `SET VARIABLE` params. Prefer these over writing SQL from scratch.

The `project` param matches against the directory name (last path component) using glob syntax: `project=myapp` matches exactly, `project=myapp*` matches the repo and its worktrees.

Every query also takes an optional `host` param (omit to span every machine, `host=work` to scope to one imported machine). See [Cross-Machine History](#cross-machine-history).

Every query, grouped by category with a one-line gloss:

#### Sessions and Prose
- `search`: find sessions by keyword
- `text-export`: dump cleaned prose
- `phrase-lift`: phrase rate, assistant-vs-user lift
- `model-summary`: assistant text per model

#### Tool Use and Friction
- `stats`: tool usage breakdown
- `errors`: recent tool errors
- `permissions`: tool calls the user rejected
- `sandbox`: sandbox-bypassing Bash calls
- `sandbox-bypass-effective-command`: normalized bypass verbs
- `sandbox-bypass-justification`: bypasses backed by a prior sandboxed failure

#### Hooks
- `hooks`: hook activity and performance
- `hook-blocks`: hook overfiring analysis
- `hook-block-then-retry-success`: blocks retried away
- `hook-config-vs-observed`: configured vs observed hooks

#### Skills
- `skills`: skill invocation counts
- `skill-activity`: work attributed per skill
- `skill-auto-vs-explicit`: auto vs explicit invocations

#### Files, Tokens, Activity
- `files`: most-read and edited file hotspots
- `repeat-read-waste`: repeat-Read context tax
- `activity`: session interaction profile
- `diagnostics`: recurring type/lint diagnostics
- `usage-timeline`: one session's token burn per time bucket (estimated cost, cache-miss ratio)
- `usage-spikes`: ranked (session, bucket) burn windows across the corpus

#### Planning and Outcomes
- `plans`: sessions using plan mode
- `plan-iterations`: per-plan growth and carry-over
- `plan-sizes`: weekly first/final plan size trend against the gate threshold
- `outcomes`: session terminal states
- `delegation`: subagent spawn model mix against the parent's main model, generic vs pinned-agent split
- `review-precision`: per-angle verdict and fix-outcome mix for code-review findings

#### Schema and Index
- `schema`: list every column
- `keys`: sample raw JSON keys
- `fields`: infer JSON keys at a path
- `index-health`: the index auditing itself

Full params and descriptions in [`references/catalog.md`](references/catalog.md). Load it before running a query you have not used.

### Markdown and YAML on Disk

Three queries (`plan-sections`, `frontmatter`, `skill-config-vs-observed`) read files on disk through the `markdown`/`yaml` community extensions instead of the index. Run them with `-init resources/extensions.sql`, which loads both in the same process before the piped query and runs under `-readonly`. The common-path queries above omit `-init` and pay nothing. Params and per-query notes are in [`references/catalog.md`](references/catalog.md).

```bash
duckdb -readonly -init ${CLAUDE_SKILL_DIR}/resources/extensions.sql ${CLAUDE_PLUGIN_DATA}/session.duckdb \
  < ${CLAUDE_SKILL_DIR}/resources/queries/plan-sections.sql
```

## Cross-Machine History

Session history copied from another machine is queryable alongside this machine's. Each machine is a `host`: this one is always `local`, and every imported machine gets a label you choose. With nothing imported, the index behaves exactly as the single-machine case.

`${CLAUDE_SKILL_DIR}/scripts/hosts.ts` lists every imported host. The listing, import, re-sync, and forget procedures live in [`references/cross-machine.md`](references/cross-machine.md). Read it when the user asks to list, import, re-sync, or remove a machine.

### Privacy

Importing another machine's history is a data-ownership decision: raise it once, at import. The egress policy records the answer. A host imported without `--egress` is marked `block_egress`, meaning its rows must be excluded from any output that leaves this machine (PR descriptions, Slack, email, web requests, uploads) by adding `host != '<label>'` (or scoping to `local`). `hosts.ts` prints each host's policy so that filter is easy to build. Pass `--egress` at import only when the source machine's history may leave this machine.

Imported corpora are a hot place for secrets in tool output and pasted text. Patterns worth watching before anything leaves the machine: `sk_live_`, `xoxb-`, `ghp_`, `AKIA`, `eyJhbGciOi`. This is a signal to review, not a redactor.

## Tables, Views, and Macros

Every table and view carries a `host` column (`local` for this machine, the label for imported ones). The `sessions` view adds `project_id` (`host || ':' || project_path`) for cross-host project identity. [`references/catalog.md`](references/catalog.md) documents every table, view, and filter macro. Load it before writing SQL against a surface you have not used, or ask DuckDB directly (see [Discovery](#discovery)).

## Known Blind Spots

The `index-health` query detects drift the corpus can show. These absences are structural, so no query can surface them. State them when an analysis depends on what they hide. Full elaboration in [`references/blind-spots.md`](references/blind-spots.md).

- **Thinking text**: persisted as signature-only stubs, unsearchable from transcripts.
- **Retention floor**: `cleanupPeriodDays` deletes old sessions, so the corpus floor ratchets forward. `~/.claude/history.jsonl` goes further back but isn't ingested.
- **Cloud and mobile sessions**: claude.ai web/mobile and cloud routines write no local JSONL.
- **Approved permission prompts**: only rejections leave a trace, so prompting friction is undercountable.
- **Offloaded tool results**: large outputs truncate to a sidecar preview. The full output never enters the index.
- **Other machines**: only imported hosts exist, so a never-imported or stale host is invisible rather than empty.

## Discovery

Don't memorize column lists. Ask DuckDB (`DESCRIBE <table>`, `information_schema.columns`) or reach into `data` directly with JSON path operators. Wrap `data->>'$.path'` in parens before any comparison: DuckDB parses `data->>'$.x' = 'y'` as `data->>('$.x' = 'y')` and fails. Worked examples in [`references/schema-discovery.md`](references/schema-discovery.md).

## Source Lookup

To retrieve the full JSONL line for a message:

```bash
sed -n '<source_line>p' <source_file>
```

`source_line` is 1-based and per-file, with two caveats. It reflects a single-file scan's row order, which DuckDB preserves in practice but does not formally guarantee for window functions. And unparseable lines are skipped at import (`ignore_errors`), so in a file containing malformed lines it can trail the physical line number. When exactness matters, verify the fetched line's `uuid` or `timestamp` against the row.

## Session File Structure

Session logs live in `~/.claude/projects/<encoded-path>/<session-id>.jsonl` where the encoded path replaces `/` with `-`.
