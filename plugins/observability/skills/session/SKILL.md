---
name: observability:session
description: Query Claude Code session history via a DuckDB index over `~/.claude/projects/`. Use when asked about Claude Code activity ("how many tokens today?", "what did I work on this week?", "which sessions discussed X?") or instead of reading, grepping, or jq-ing session transcripts. Not for codebase search, git log queries, or arbitrary databases.
argument-hint: "[--refresh] [--host label] [--since date]"
allowed-tools:
  - Bash
  - Read
---

# Session

Query Claude Code history from a DuckDB index over the JSONL session files. Report each figure with the named query or SQL that produced it, and any `index-health` alert or Known Blind Spot that bounds it.

Current session ID: `${CLAUDE_SESSION_ID}`

## Arguments

- `--refresh`: run `refresh.ts --refresh` before querying. Default: the incremental refresh.
- `--host <label>`: scope queries through the `host` param. Default: every host, including `local`.
- `--since <date>`: pass as the `after_date` param. Default: the full index.

## Database

The index is `~/.local/share/claude-sessions/session.duckdb` (under `$XDG_DATA_HOME` when set). Use that path directly in every query and agent prompt.

### Refresh

Run `refresh.ts` before querying. It imports changed files, drops rows for deleted ones, and prints the DB path. Within `--max-age` (default 300 seconds) of the last refresh it exits without opening the database. Pass `--refresh` when the user asks for the latest data.

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/refresh.ts
```

### Querying

Open the index with `duckdb -readonly -json -init ${CLAUDE_SKILL_DIR}/resources/limits.sql`:

- `-readonly`: a read-write open blocks refreshes and other readers.
- `-init limits.sql`: caps memory and threads. DuckDB's per-process defaults let a few concurrent readers freeze the machine.
- `-json`: the default box format truncates to 40 rows, and `-csv` breaks rows on newlines embedded in `command` and `text`.

Parameterize with `SET VARIABLE` and read with `getvariable('key')`. Quote reserved words: `SET VARIABLE "limit" = 5`.

```bash
duckdb -readonly -json -init ${CLAUDE_SKILL_DIR}/resources/limits.sql ~/.local/share/claude-sessions/session.duckdb "SELECT model, SUM(output_tokens) FROM message_usage GROUP BY model"
duckdb -readonly -json -init ${CLAUDE_SKILL_DIR}/resources/limits.sql ~/.local/share/claude-sessions/session.duckdb < ${CLAUDE_SKILL_DIR}/resources/queries/stats.sql
```

`scripts/usage.ts` renders one session's token-burn timeline (`--session <id>`), or the top sessions by estimated cost (`--days <n>`). Its cost estimate comes from public API rates and comes to about 0.97 of billed spend.

### Locking

Read-only opens share the lock. A refresh with work to do needs exclusive access. A reader and a writer that collide fail with `Could not set lock`. Retry after the other side finishes. `refresh.ts` retries on its own and exits 0 when a concurrent refresh holds the lock.

### Parallel Queries (Workflows)

For a fan-out of agents over the corpus, the orchestrator runs `refresh.ts --refresh` once up front. Each agent then opens the DB path read-only with `-init limits.sql` and runs in the shared checkout. [`references/workflows.md`](references/workflows.md) shows param scoping and the breadth-first survey surfaces.

For mining config-change candidates across the whole corpus, follow [`references/discovery.md`](references/discovery.md).

## Named Queries

Run the queries in `resources/queries/` by name with `SET VARIABLE` params before writing SQL from scratch. Every query takes `project` (a glob on the directory's last path component: `myapp*` matches the repo and its worktrees) and `host`.

The most used:

- `index-health`: the index auditing itself. Run it first in any analysis pass, since its alerts cap what the rest can claim.
- `activity`: session interaction profile, one row per prompt source, plus interruptions, compactions, API retries, hook friction, permission modes.
- `hooks`: per-hook runs, friction rate, and latency corrected for host-wide slowdowns (`excess_p95_ms`, not `p95_ms`).
- `hook-blocks`: hook overfiring, grouped by normalized reason signature, including the PreToolUse denies `hook_events` never records.
- `skill-auto-vs-explicit`: per skill, model-routed vs chained vs typed. The `disable-model-invocation` lever.
- `skill-config-vs-observed`: installed skills that never fire, the curation instrument (reads disk, needs `-init`).
- `sandbox-bypass-effective-command`: bypassed commands by their real verb, with how many followed a failed sandboxed run, the `excludedCommands` candidates.
- `repeat-read-waste`: repeat Reads split by cause, isolating the true context tax from pagination and fan-out.
- `delegation`: whether expensive parents push subagent spawns down to cheaper models.
- `usage-timeline`: one session's token burn per time bucket, with estimated cost and a context-size proxy.
- `outcomes`: session terminal states (shipped, abandoned-with-edits, handed off, no artifact), the outcome side the activity queries never measure.

To find sessions about a topic, run `search` first. Put the topic's synonyms, command names, and API names in one `query`, since a session scores on every term it contains:

```bash
duckdb -readonly -json -init ${CLAUDE_SKILL_DIR}/resources/limits.sql -cmd "SET VARIABLE query = 'taskpolicy renice setpriority cpu priority'" \
  ~/.local/share/claude-sessions/session.duckdb < ${CLAUDE_SKILL_DIR}/resources/queries/search.sql
```

`search` covers prompts, assistant prose, tool calls, and their output, and `matched_surfaces` names where terms hit. Use `ILIKE` only for what it leaves out: Read output, Write and Edit file contents, tool text past 2,000 characters per call, subagent turns, skill bodies, and hook output.

The rest:

<!-- generated:queries -->
`already-allowed-still-prompting`, `bare-refs`, `catalog-reinjection-thrash-sessions`, `classifier`, `cli-health`, `field-drift`, `hook-block-then-retry-success`, `hook-config-vs-observed`, `hook-self-timing`, `model-summary`, `mods`, `permissions`, `plan-iterations`, `plan-sections`, `plan-sizes`, `prune-acceptance`, `sandbox-bypass-scaffold`, `sandbox-path-deny-recurrence`, `search`, `skill-activity`, `stats`, `stop-hook-noop-detector`, `text-export`, `tool-failure-rates`, `top-sessions`, `usage-spikes`
<!-- /generated:queries -->

[`references/catalog.md`](references/catalog.md) gives each query's purpose and params. Before running a query you have not used, read the YAML header of its `resources/queries/<name>.sql` for its output, caveats, and param defaults.

### Queries That Read Disk

`plan-sections` and `skill-config-vs-observed` parse files through the `markdown`/`yaml` extensions, so add `-cmd ".read resources/extensions.sql"` after `-init`. `hook-self-timing` and `hook-config-vs-observed` read JSON and need no extension. Each header names its glob param and default.

```bash
duckdb -readonly -json -init ${CLAUDE_SKILL_DIR}/resources/limits.sql \
  -cmd ".read ${CLAUDE_SKILL_DIR}/resources/extensions.sql" ~/.local/share/claude-sessions/session.duckdb \
  < ${CLAUDE_SKILL_DIR}/resources/queries/plan-sections.sql
```

## Cross-Machine History

Each machine is a `host`: this one is `local`, and each imported machine has a chosen label. `${CLAUDE_SKILL_DIR}/scripts/hosts.ts` lists them. To list, import, re-sync, or remove a machine, follow [`references/cross-machine.md`](references/cross-machine.md).

### Privacy

Raise data ownership once, at import. Pass `--egress` only when the source machine's history may leave this machine. A host imported without it is `block_egress`: exclude its rows with `host != '<label>'` (or scope to `local`) from anything that leaves the machine, such as PR descriptions, Slack, email, web requests, and uploads. `hosts.ts` prints each host's policy.

Before anything leaves the machine, review imported text for secret prefixes such as `sk_live_`, `xoxb-`, `ghp_`, `AKIA`, and `eyJhbGciOi`.

## Tables, Views, and Macros

Every table and view carries `host`. The `sessions` view adds `project_id` (`host || ':' || project_path`). Read [`references/catalog.md`](references/catalog.md) before writing SQL against a surface you have not used.

Columns of the surfaces ad-hoc SQL reads most (`DESCRIBE <name>` for anything else):

!`bun ${CLAUDE_SKILL_DIR}/scripts/schema.ts`

For a field not pinned to a column, reach into `data` with JSON path operators, wrapped in parens before any comparison: `(data->>'$.x') = 'y'`. [`references/schema-discovery.md`](references/schema-discovery.md) has examples.

## Known Blind Spots

No query can surface these. State them when an analysis depends on what they hide. [`references/blind-spots.md`](references/blind-spots.md) elaborates.

- **Thinking text**: persisted as signature-only stubs, unsearchable from transcripts.
- **Retention floor**: `cleanupPeriodDays` deletes old sessions, so the corpus floor ratchets forward. `~/.claude/history.jsonl` goes further back but isn't ingested.
- **Cloud and mobile sessions**: claude.ai web/mobile and cloud routines write no local JSONL.
- **Approved permission prompts before 2026-10-07**: only rejections left a trace. Later approvals are in `permission_requests`.
- **Offloaded tool results**: large outputs truncate to a sidecar preview. The full output never enters the index.
- **Other machines**: only imported hosts exist, so a never-imported or stale host is invisible rather than empty.

## Source Lookup

Session logs live at `~/.claude/projects/<encoded-path>/<session-id>.jsonl`, where the encoded path replaces `/` with `-`. Fetch a row's full JSONL line with `sed -n '<source_line>p' <source_file>`. `source_line` is 1-based per file and can trail the physical line in a file with malformed lines, so check the fetched line's `uuid` or `timestamp` when exactness matters.
