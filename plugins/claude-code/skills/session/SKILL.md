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

**Current Session ID**: `${CLAUDE_SESSION_ID}`

## Arguments

Map any arguments to the mechanisms below:

- `--refresh`: force a full rescan via `refresh.ts --refresh` before querying. Default: incremental refresh keyed on file mtime.
- `--host <label>`: scope queries to one imported machine through the `host` param. Default: span every host, including `local`. See [Cross-Machine History](#cross-machine-history).
- `--since <date>`: pass as the `after_date` param to scope queries from that date forward. Default: the full index.

## Database

The session index is a DuckDB database at `$CLAUDE_PLUGIN_DATA/session.duckdb`. The refresh script ensures it is current before querying.

### Refresh

Run `refresh.ts` to scan `~/.claude/projects/**/*.jsonl` and update the index. Pass `--refresh` to force a rescan when the user asks for the latest data. The script prints the resolved DB path to stdout.

```bash
${CLAUDE_SKILL_DIR}/scripts/refresh.ts
${CLAUDE_SKILL_DIR}/scripts/refresh.ts --refresh
```

### Querying

After refresh, query the DB with the `duckdb` CLI or any DuckDB client. Querying never writes, so open `-readonly`: it takes no lock, so it never contends with a refresh or another query. Named SQL files in `resources/queries/` provide common queries. Use `SET VARIABLE` for parameterization and `getvariable('key')` in SQL. Quote variable names that are reserved words: `SET VARIABLE limit = 5` is a parser error (`limit` is reserved), `SET VARIABLE "limit" = 5` works; `getvariable('limit')` is unaffected.

```bash
DB_PATH=$(${CLAUDE_SKILL_DIR}/scripts/refresh.ts)
duckdb -readonly "$DB_PATH" "SELECT model, SUM(output_tokens) FROM message_usage GROUP BY model"
duckdb -readonly "$DB_PATH" < ${CLAUDE_SKILL_DIR}/resources/queries/stats.sql
```

### Parallel Queries (Workflows)

To investigate the corpus with a fan-out of agents (breadth search for leads, then a depth pass per lead), refresh once up front and have every agent open the index read-only:

```bash
DB=$(${CLAUDE_SKILL_DIR}/scripts/refresh.ts --refresh)        # orchestrator, once
duckdb -readonly "$DB" < ${CLAUDE_SKILL_DIR}/resources/queries/activity.sql   # agents, in parallel
```

`refresh.ts` takes an exclusive write lock, so it must run alone; two refreshes (or any two read-write opens) at once fail with a lock conflict. A read-only open takes no lock, so any number of agents query the same file concurrently. Hand the resolved `$DB` path to the agents and never let a fanned-out agent call `refresh.ts`. Queries read a shared file, so the agents need no worktree.

Params work the same from the CLI: `getvariable` returns NULL for an unset variable and every named query null-guards its params, so a bare `duckdb -readonly "$DB" < query.sql` runs unfiltered. Prepend `SET VARIABLE` lines to scope it:

```bash
duckdb -readonly "$DB" <<'SQL'
SET VARIABLE after_date = '2026-05-01';
SET VARIABLE hook = '*tropes*';
.read ${CLAUDE_SKILL_DIR}/resources/queries/hook-blocks.sql
SQL
```

Breadth-first leads come from the survey surfaces (`records` taxonomy, `fields` for schema inference, `activity`, `hooks`, `diagnostics`, `skill-activity`); a depth pass is then custom read-only SQL over whatever table or view the survey pointed at.

For self-improvement discovery (fanning out over the whole corpus to mine config-change candidates, then grounding them against the live config), [`references/discovery.md`](references/discovery.md) carries the full recipe: the dimension-to-query cheat sheet, the mandatory grounding pass, the host-safety rules, and the Tier-2 query catalog (six discovery queries shipped as SQL but kept out of the catalog above).

## Named Queries

Built-in queries in `resources/queries/` run by name with `SET VARIABLE` params. Prefer these over writing SQL from scratch.

The `project` param matches against the directory name (last path component) using glob syntax: `project=myapp` matches exactly, `project=myapp*` matches the repo and its worktrees.

Every query also takes an optional `host` param. Omit it to span every machine (including `local`); pass `host=work` to scope to one imported machine. See [Cross-Machine History](#cross-machine-history).

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

#### Planning and Outcomes
- `plans`: sessions using plan mode
- `plan-iterations`: per-plan growth and carry-over
- `outcomes`: session terminal states

#### Schema and Index
- `schema`: list every column
- `keys`: sample raw JSON keys
- `fields`: infer JSON keys at a path
- `index-health`: the index auditing itself

Full params and descriptions in [`references/catalog.md`](references/catalog.md). Load it before running a query you have not used.

### Markdown and YAML on Disk

Two queries read files on disk through community extensions instead of the index. They need `markdown`/`yaml` loaded, so run them with `-init resources/extensions.sql`, which loads both in the same process before the piped query and runs under `-readonly`. The common-path queries above omit `-init` and pay nothing.

```bash
duckdb -readonly -init ${CLAUDE_SKILL_DIR}/resources/extensions.sql "$DB" \
  < ${CLAUDE_SKILL_DIR}/resources/queries/plan-sections.sql
```

Three queries use this path: `plan-sections`, `frontmatter`, and `skill-config-vs-observed`. Params and per-query notes are in [`references/catalog.md`](references/catalog.md).

The reusable pattern for markdown/YAML on disk: a self-defaulting glob (`~` expands to home, override via `SET VARIABLE`) feeding a table function over files (`read_markdown_sections` for body structure, `read_yaml_frontmatter` for frontmatter), never materializing file bodies into a column, with extension setup centralized in `resources/extensions.sql` and pulled in via `-init`. Follow it for new markdown-on-disk needs rather than reinventing regex parsing.

## Cross-Machine History

Session history copied from another machine is queryable alongside this machine's. Each machine is a `host`: this one is always `local`, and every imported machine gets a label you choose. With nothing imported, the index behaves exactly as the single-machine case.

### Listing hosts

```bash
${CLAUDE_SKILL_DIR}/scripts/hosts.ts
```

Shows each host with its import time, egress policy, last index, rsync source, and a ready-to-run re-sync command.

### Importing a machine

Copy the source machine's `~/.claude/projects/` into the import root, then register it. The `!` prefix runs the commands in your own shell, so SSH host-key trust and any 2FA stay in your hands.

```bash
mkdir -p ~/.claude/session-imports/<label>/projects
rsync -avn --update <user@host>:.claude/projects/ ~/.claude/session-imports/<label>/projects/   # dry run
rsync -av  --update <user@host>:.claude/projects/ ~/.claude/session-imports/<label>/projects/   # real copy
${CLAUDE_SKILL_DIR}/scripts/import.ts --host <label> --source '<user@host>:.claude/projects/'
```

`import.ts` writes a manifest (dirs `0700`, manifest `0600`) recording the label, `--source`, and egress policy, then re-indexes. The whole `projects/` tree is copied even though only `*.jsonl` is indexed, because that tree is also the re-sync unit.

### Re-syncing

The source stored in the manifest doubles as the re-sync input, so refreshing is the same rsync line followed by `import.ts`:

```bash
rsync -av --update <source> ~/.claude/session-imports/<label>/projects/
${CLAUDE_SKILL_DIR}/scripts/import.ts --host <label>
```

Re-running `import.ts` on a registered host leaves its manifest intact and re-indexes only the files whose mtime advanced (the watermark is per-host, so `rsync -a` preserving source mtimes is not a problem). `hosts.ts` prints the exact line per host.

### Forgetting a machine

```bash
${CLAUDE_SKILL_DIR}/scripts/forget.ts --host <label>
```

Deletes the host's rows from the index and removes its synced files. `local` cannot be forgotten.

### Privacy

Importing another machine's history is a data-ownership decision: raise it once, at import. The egress policy records the answer. A host imported without `--egress` is marked `block_egress`, meaning its rows must be excluded from any output that leaves this machine (PR descriptions, Slack, email, web requests, uploads) by adding `host != '<label>'` (or scoping to `local`). `hosts.ts` prints each host's policy so that filter is easy to build. Pass `--egress` at import only when the source machine's history may leave this machine.

Imported corpora are a hot place for secrets in tool output and pasted text. Patterns worth watching before anything leaves the machine: `sk_live_`, `xoxb-`, `ghp_`, `AKIA`, `eyJhbGciOi`. This is a signal to review, not a redactor.

## Tables, Views, and Macros

Every table and view carries a `host` column (`local` for this machine, the label for imported ones). The `sessions` view adds `project_id` (`host || ':' || project_path`) for cross-host project identity. [`references/catalog.md`](references/catalog.md) documents every table, view, and filter macro. Load it before writing SQL against a surface you have not used, or ask DuckDB directly (see [Discovery](#discovery)).

## Known Blind Spots

The `index-health` query detects drift the corpus can show; these absences are structural, so no query can surface them. State them when an analysis depends on what they hide.

- **Thinking text**: Claude Code persists thinking blocks as signature-only stubs. `content_items` rows with `type = 'thinking'` exist but carry no text; reasoning is unsearchable from transcripts and must be intercepted at runtime (hooks) if needed.
- **Retention floor**: `cleanupPeriodDays` deletes old session files, and the index rebuilds from surviving JSONL on migration, so the corpus floor ratchets forward (see `corpus-window`). `~/.claude/history.jsonl` holds prompt-level history much further back but is not ingested.
- **Cloud and mobile sessions**: claude.ai web/mobile chats and cloud routines write no local JSONL. A `bridge-session` record marks only that a cloud bridge existed; the cloud side's content stays remote.
- **Approved permission prompts**: only rejections leave a trace (`"User rejected tool use"` results). A prompt the user approved is indistinguishable from a call that never prompted, so prompting friction is undercountable.
- **Offloaded tool results**: large outputs are truncated to a `<persisted-output>` preview pointing at a sidecar file under `tool-results/`; the full output never enters the index.
- **Other machines**: only imported hosts exist. A machine never imported, or one gone stale (see `host-staleness`), is invisible rather than empty.

## Discovery

Don't memorize column lists. Ask DuckDB.

```sql
SELECT * FROM information_schema.columns WHERE table_schema = 'main';
DESCRIBE messages;
DESCRIBE content_items;
```

For fields not in the pinned columns, reach into `data` directly with JSON path operators.

```sql
SELECT (data->>'$.message.model') AS model
FROM messages
WHERE type = 'assistant' AND (data->>'$.message.model') IS NOT NULL
GROUP BY model;
```

Wrap `data->>'$.path'` in parens before any comparison. DuckDB parses `data->>'$.x' = 'y'` as `data->>('$.x' = 'y')` (boolean array index) and fails.

## Source Lookup

To retrieve the full JSONL line for a message:

```bash
sed -n '<source_line>p' <source_file>
```

`source_line` is 1-based and per-file (partitioned by `source_file`).

## Session File Structure

Session logs live in `~/.claude/projects/<encoded-path>/<session-id>.jsonl` where the encoded path replaces `/` with `-`. The index lives at `$CLAUDE_PLUGIN_DATA/session.duckdb`, refreshed incrementally based on file mtime.
