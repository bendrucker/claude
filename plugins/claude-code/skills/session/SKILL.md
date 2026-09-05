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

After refresh, query with the `duckdb` CLI or any DuckDB client, always `-readonly`. Querying never writes, and a read-write open would block refreshes and other readers. Add `-json` too: the default box format returns only 40 rows however many matched, and `-csv` emits the newlines embedded in `command` and `text` raw, so a row stops being one line. Named SQL files in `resources/queries/` provide common queries. Use `SET VARIABLE` for parameterization and `getvariable('key')` in SQL. Quote variable names that are reserved words: `SET VARIABLE limit = 5` is a parser error (`limit` is reserved), `SET VARIABLE "limit" = 5` works. `getvariable('limit')` is unaffected either way.

```bash
duckdb -readonly -json ${CLAUDE_PLUGIN_DATA}/session.duckdb "SELECT model, SUM(output_tokens) FROM message_usage GROUP BY model"
duckdb -readonly -json ${CLAUDE_PLUGIN_DATA}/session.duckdb < ${CLAUDE_SKILL_DIR}/resources/queries/stats.sql
```

`scripts/usage.ts` renders a session's token-burn timeline (`--session <id>`) in the terminal, or the top sessions by estimated cost (`--days <n>`) when no session is given. It opens the index read-only. Cost is an estimate from public API rates. Checked against the 62 sessions that carry a real `cost-state.totalCostUSD`, it comes in at 0.97 of billed spend ($1,582 against $1,631), so treat it as a close approximation. That record appears in only 66 of 1,645 recent files, which is why the estimate is the primary surface.

### Locking

DuckDB locks the database file per process. Read-only opens take a shared lock, and any number of them coexist. A write open (a refresh that has work to do) needs exclusive access. It cannot start while readers hold the file, and a reader cannot open mid-refresh. Either collision fails with `Could not set lock`. Retry after the other side finishes. `refresh.ts` retries briefly on its own, and when a concurrent refresh holds the lock it prints the path and exits 0, since the other run is doing the same work.

### Parallel Queries (Workflows)

For a fan-out of agents investigating the corpus, the orchestrator runs `refresh.ts --refresh` once up front, then every agent opens `${CLAUDE_PLUGIN_DATA}/session.duckdb` read-only. Never let a fanned-out agent call `refresh.ts`: past the stamp's `--max-age` it opens read-write and collides with every reader. Queries read a shared file, so the agents need no worktree. Worked example (param scoping via `SET VARIABLE`, breadth-first survey surfaces) in [`references/workflows.md`](references/workflows.md).

For self-improvement discovery (fanning out over the whole corpus to mine config-change candidates, then grounding them against the live config), [`references/discovery.md`](references/discovery.md) carries the full recipe.

## Named Queries

Built-in queries in `resources/queries/` run by name with `SET VARIABLE` params. Prefer these over writing SQL from scratch.

The `project` param matches against the directory name (last path component) using glob syntax: `project=myapp` matches exactly, `project=myapp*` matches the repo and its worktrees.

Every query also takes an optional `host` param (omit to span every machine, `host=work` to scope to one imported machine). See [Cross-Machine History](#cross-machine-history).

The eleven that carry most of the measured usage:

- `index-health`: the index auditing itself. Run it first in any analysis pass, since its alerts cap what the rest can claim.
- `activity`: session interaction profile, one row per prompt source, plus interruptions, compactions, API retries, hook friction, permission modes.
- `hooks`: per-hook runs, friction rate, and latency corrected for host-wide slowdowns (`excess_p95_ms`, not `p95_ms`).
- `hook-blocks`: hook overfiring, grouped by normalized reason signature, including the PreToolUse denies `hook_events` never records.
- `skill-auto-vs-explicit`: per skill, model-routed vs chained vs typed. The `disable-model-invocation` lever.
- `skill-config-vs-observed`: installed skills that never fire, the curation instrument (reads disk, needs `-init`).
- `sandbox-bypass-effective-command`: bypassed commands normalized to their real verb, the `excludedCommands` candidates.
- `repeat-read-waste`: repeat Reads split by cause, isolating the true context tax from pagination and fan-out.
- `delegation`: whether expensive parents push subagent spawns down to cheaper models.
- `usage-timeline`: one session's token burn per time bucket, with estimated cost and a context-size proxy.
- `outcomes`: session terminal states (shipped, abandoned-with-edits, handed off, no artifact), the outcome side the activity queries never measure.

The rest, by name, described in [`references/catalog.md`](references/catalog.md):

- Sessions and prose: `search`, `text-export`, `model-summary`
- Tool use and friction: `stats`, `errors`, `permissions`, `sandbox`, `sandbox-bypass-justification`
- Hooks: `hook-block-then-retry-success`, `hook-config-vs-observed`
- Skills: `skills`, `skill-activity`
- Files, tokens, activity: `files`, `diagnostics`, `usage-spikes`, `top-sessions`
- Planning and review: `plans`, `plan-iterations`, `plan-sections`, `plan-sizes`, `review-precision`
- Schema and index: `schema`, `keys`, `fields`, `field-drift`, `frontmatter`

Load [`references/catalog.md`](references/catalog.md) before running a query you have not used. A further tier, aimed at the self-improvement loop, is listed in [`references/discovery.md`](references/discovery.md).

### Queries That Read Disk

Four queries read files on disk instead of the index. Three of them (`plan-sections`, `frontmatter`, `skill-config-vs-observed`) parse structure through the `markdown`/`yaml` community extensions, so run those with `-init resources/extensions.sql`, which loads both in the same process before the piped query and runs under `-readonly`. `hook-self-timing` reads JSONL and needs no extension. The common-path queries above omit `-init` and pay nothing. Params and per-query notes are in [`references/catalog.md`](references/catalog.md).

```bash
duckdb -readonly -json -init ${CLAUDE_SKILL_DIR}/resources/extensions.sql ${CLAUDE_PLUGIN_DATA}/session.duckdb \
  < ${CLAUDE_SKILL_DIR}/resources/queries/plan-sections.sql
```

## Cross-Machine History

Session history copied from another machine is queryable alongside this machine's. Each machine is a `host`: this one is always `local`, and every imported machine gets a label you choose. With nothing imported, the index behaves exactly as the single-machine case.

`${CLAUDE_SKILL_DIR}/scripts/hosts.ts` lists every imported host. The listing, import, re-sync, and forget procedures live in [`references/cross-machine.md`](references/cross-machine.md). Read it when the user asks to list, import, re-sync, or remove a machine.

### Privacy

Importing another machine's history is a data-ownership decision: raise it once, at import. The egress policy records the answer. A host imported without `--egress` is marked `block_egress`, meaning its rows must be excluded from any output that leaves this machine (PR descriptions, Slack, email, web requests, uploads) by adding `host != '<label>'` (or scoping to `local`). `hosts.ts` prints each host's policy so that filter is easy to build. Pass `--egress` at import only when the source machine's history may leave this machine.

Imported corpora are a hot place for secrets in tool output and pasted text. Patterns worth watching before anything leaves the machine: `sk_live_`, `xoxb-`, `ghp_`, `AKIA`, `eyJhbGciOi`. This is a signal to review, not a redactor.

## Tables, Views, and Macros

Every table and view carries a `host` column (`local` for this machine, the label for imported ones). The `sessions` view adds `project_id` (`host || ':' || project_path`) for cross-host project identity. [`references/catalog.md`](references/catalog.md) documents every table, view, and filter macro, and says what each one holds. Load it before writing SQL against a surface you have not used.

Columns of the ten surfaces ad-hoc SQL reads most. `DESCRIBE <name>` for anything else.

!`bun ${CLAUDE_SKILL_DIR}/scripts/schema.ts`

## Known Blind Spots

The `index-health` query detects drift the corpus can show. These absences are structural, so no query can surface them. State them when an analysis depends on what they hide. Full elaboration in [`references/blind-spots.md`](references/blind-spots.md).

- **Thinking text**: persisted as signature-only stubs, unsearchable from transcripts.
- **Retention floor**: `cleanupPeriodDays` deletes old sessions, so the corpus floor ratchets forward. `~/.claude/history.jsonl` goes further back but isn't ingested.
- **Cloud and mobile sessions**: claude.ai web/mobile and cloud routines write no local JSONL.
- **Approved permission prompts**: only rejections leave a trace, so prompting friction is undercountable.
- **Offloaded tool results**: large outputs truncate to a sidecar preview. The full output never enters the index.
- **Other machines**: only imported hosts exist, so a never-imported or stale host is invisible rather than empty.

## Discovery

For a surface outside the map above, `DESCRIBE <table>` or `information_schema.columns`. For anything not pinned to a column, reach into `data` with JSON path operators. Wrap `data->>'$.path'` in parens before any comparison: DuckDB parses `data->>'$.x' = 'y'` as `data->>('$.x' = 'y')` and fails. Worked examples in [`references/schema-discovery.md`](references/schema-discovery.md).

## Source Lookup

To retrieve the full JSONL line for a message:

```bash
sed -n '<source_line>p' <source_file>
```

`source_line` is 1-based and per-file, with two caveats. It reflects a single-file scan's row order, which DuckDB preserves in practice but does not formally guarantee for window functions. And unparseable lines are skipped at import (`ignore_errors`), so in a file containing malformed lines it can trail the physical line number. When exactness matters, verify the fetched line's `uuid` or `timestamp` against the row.

## Session File Structure

Session logs live in `~/.claude/projects/<encoded-path>/<session-id>.jsonl` where the encoded path replaces `/` with `-`.
