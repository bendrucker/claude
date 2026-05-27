---
name: claude-code:session
description: Introspect on your own Claude Code usage and history (session ID, duration, tokens consumed, tool usage patterns, time per project, recent activity summaries, or searching past conversations). Use whenever the user asks about their Claude Code activity ("what's my session ID?", "how many tokens today?", "what did I work on this week?", "find that conversation where I set up X", "am I overusing Bash?"). Do NOT use for general codebase search, git log queries, or arbitrary databases.
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

## Tables and Views

- `raw`: one row per JSONL line. Pinned scalar columns (`session_id`, `type`, `project_path`, `git_branch`, `is_meta`, `is_sidechain`, `duration_ms`, `timestamp`, `summary`, `input_tokens`, `output_tokens`, `source_file`, `source_line`) plus a `data JSON` column that holds the full original line.
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
