---
name: claude-code:session
description: Query Claude Code session history via a DuckDB index over `~/.claude/projects/**/*.jsonl`. Use when the user asks about Claude Code activity ("how many tokens today?", "what did I work on this week?"), or when you would otherwise read, grep, or jq session transcripts directly from `~/.claude/projects/`. Do NOT use for general codebase search, git log queries, or arbitrary databases.
allowed-tools:
  - Bash
  - Read
---

# Session

Search and analyze Claude Code conversation history via a DuckDB index over JSONL session files.

**Current Session ID**: `${CLAUDE_SESSION_ID}`

## Database

The session index is a DuckDB database at `$CLAUDE_PLUGIN_DATA/session.duckdb`. The refresh script ensures it is current before querying.

### Refresh

Run `refresh.ts` to scan `~/.claude/projects/**/*.jsonl` and update the index. Pass `--refresh` to force a rescan when the user asks for the latest data. The script prints the resolved DB path to stdout.

```bash
${CLAUDE_SKILL_DIR}/scripts/refresh.ts
${CLAUDE_SKILL_DIR}/scripts/refresh.ts --refresh
```

### Querying

After refresh, query the DB with the `duckdb` CLI or any DuckDB client. Named SQL files in `resources/queries/` provide common queries. Use `SET VARIABLE` for parameterization and `getvariable('key')` in SQL.

```bash
DB_PATH=$(${CLAUDE_SKILL_DIR}/scripts/refresh.ts)
duckdb "$DB_PATH" "SELECT model, SUM(output_tokens) FROM messages WHERE type = 'assistant' GROUP BY model"
duckdb "$DB_PATH" < ${CLAUDE_SKILL_DIR}/resources/queries/stats.sql
```

## Named Queries

Built-in queries in `resources/queries/` run by name with `SET VARIABLE` params. Prefer these over writing SQL from scratch.

The `project` param matches against the directory name (last path component) using glob syntax: `project=myapp` matches exactly, `project=myapp*` matches the repo and its worktrees.

Every query also takes an optional `host` param. Omit it to span every machine (including `local`); pass `host=work` to scope to one imported machine. See [Cross-Machine History](#cross-machine-history).

- `search`: find sessions by keyword (ILIKE on `content_text` and `summary`). Params: `query`, `limit`, `after_date`, `before_date`, `project`
- `stats`: tool usage breakdown with error rates and aggregate totals. Params: `after_date`, `before_date`, `project`
- `errors`: recent tool errors with type filtering. Params: `error_type` (`rejection` or `failure`), `limit`, `after_date`, `before_date`, `project`
- `permissions`: tool calls the user rejected. Params: `limit`, `after_date`, `before_date`, `project`
- `sandbox`: Bash calls that bypassed the sandbox (`dangerouslyDisableSandbox`), with back-links to prior failed sandboxed calls of the same command. Params: `limit`, `after_date`, `before_date`, `project`
- `skills`: skill invocation counts by name. Params: `skill`, `after_date`, `before_date`, `project`
- `text-export`: dump cleaned prose from `text_content` (TSV-friendly). Params: `role`, `model` (glob), `after_date`, `before_date`, `project`, `min_chars`.
- `phrase-lift`: count a phrase per role/model with per-1M-char rate and assistant-vs-user lift. Params: `phrase`, `after_date`, `before_date`.
- `model-summary`: assistant text item/message/char counts per model. Params: `after_date`, `before_date`, `project`.
- `schema`: list every column in every table/view. Use this first when you don't know what's available.
- `keys`: sample which top-level JSON keys appear in `raw.data` (the unstructured part), with occurrence counts.

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

## Tables and Views

Every table and view carries a `host` column (`local` for this machine, the label for imported ones). The `sessions` view adds `project_id` (`host || ':' || project_path`) for cross-host project identity.

- `raw`: one row per JSONL line. Pinned scalar columns (`host`, `session_id`, `type`, `project_path`, `git_branch`, `is_meta`, `is_sidechain`, `duration_ms`, `timestamp`, `summary`, `input_tokens`, `output_tokens`, `source_file`, `source_line`) plus a `data JSON` column that holds the full original line.
- `messages`: view over `raw` filtered to `type IN ('user', 'assistant')`, with a derived `content_text` (string-form messages only) and a `summary` joined from summary rows.
- `content_items`: one row per element of `data->'$.message.content'`, with pinned columns (`type`, `name`, `id`, `tool_use_id`, `text`, `content`, `is_error`) plus `data JSON` (the content item) and `tool_use_result JSON` (merged from the parent message).
- `text_content`: one row per prose text item across user and assistant messages. Columns: `session_id`, `timestamp`, `role`, `model` (NULL for user), `project_path`, `text` (fenced and inline-backtick code stripped), `raw_text`, `source_file`, `source_line`.
- `sessions`: aggregated session-level stats (start/end time, duration, message counts).
- `tool_calls`: one row per tool use.
- `tool_errors`: tool results where `is_error` is true, joined with the originating tool call. `error_type` is `rejection` or `failure`.
- `permission_requests`: tool calls the user rejected.
- `sandbox_bypasses`: Bash calls that used `dangerouslyDisableSandbox=true`, with back-links to retried failures.
- `skill_calls`: one row per `Skill` tool invocation.

## Macros

- `date_filter(ts, after, before)`: filter a timestamp column by optional date bounds.
- `project_filter(path, pattern)`: match the last path component against a glob pattern.
- `host_filter(host_col, host_val)`: pass through when `host_val` is NULL, else match the host column.
- `project_id(host, path)`: `host || ':' || path`, a cross-host project identity.

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
