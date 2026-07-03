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
duckdb -readonly "$DB_PATH" "SELECT model, SUM(output_tokens) FROM messages WHERE type = 'assistant' GROUP BY model"
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
- `hooks`: hook activity and performance, one row per hook (keyed by command). Runs, blocks, asks, errors, cancelled, context injections, friction rate, p50/p95 duration. Params: `event` (hook event filter), `hook` (glob on command/name), `after_date`, `before_date`, `project`.
- `hook-blocks`: hook overfiring analysis. Blocking events grouped by hook and normalized reason signature, with `storm_sessions` (sessions blocked 2+ times by the same signature) and `max_burst`. Params: `hook` (glob), `after_date`, `before_date`, `project`.
- `activity`: session interaction profile, separating human signals (prompts, interruptions) from automated ones (auto-continuations, scheduled fires, queued goals), plus compactions, API retries, hook friction, and permission-mode distribution. Params: `after_date`, `before_date`, `project`.
- `diagnostics`: recurring type-checker/linter/LSP diagnostics grouped by source/severity/code, with file and session spread. The signal for systematic mistakes. Params: `after_date`, `before_date`, `project`.
- `files`: file hotspots, the files read and edited most across sessions. Params: `limit`, `after_date`, `before_date`, `project`.
- `skill-activity`: work attributed to each skill (assistant turns, sessions, input/output/cache tokens). Swap `attribution_skill` for `attribution_plugin`/`attribution_agent` in the SQL to re-cut. Params: `after_date`, `before_date`, `project`.
- `fields`: schema discovery by inference. Enumerates JSON keys at a path for records of a kind, with each value's JSON type and a count (divergent types appear as multiple rows). Params: `kind` (glob on `records.kind`, or null for all), `path` (JSON path, e.g. `$` or `$.attachment`), `after_date`, `before_date`, `project`.
- `hook-block-then-retry-success`: per hook, blocks that were retried away by a same-hook success in the same session within N seconds (noise vs genuine redirect). Params: `hook` (glob on command/name), `within_seconds` (default 300), `after_date`, `before_date`, `project`, `host`.
- `repeat-read-waste`: repeat Reads (same file re-read within a session) decomposed by cause: paginated (`offset`/`limit` chunking), sidechain (subagent fan-out), after-own-edit, and true repeats (the actionable context tax), with char/token cost. Params: `after_date`, `before_date`, `project`, `host`.
- `skill-auto-vs-explicit`: per skill, model-auto (empty args) vs explicit/slash invocations, the core `disable-model-invocation` lever. Params: `min_calls` (default 1), `after_date`, `before_date`, `project`, `host`.
- `sandbox-bypass-effective-command`: top `dangerouslyDisableSandbox` commands normalized to their real verb after stripping leading `cd <path>` wrappers, `echo` lines, and env-assignment prefixes (`excludedCommands` candidates). Params: `min_count` (default 5), `after_date`, `before_date`, `project`, `host`.
- `plans`: sessions that used plan mode (ExitPlanMode), with per-session plan count, redirect/approved/handoff breakdown, and a `replan_tier` label keyed on mid-session redirects (`single` / `replan` for 1 / `off-rails` for 2+). A terminal rejection with no file edits afterward counts as a handoff (plan here, implement in a fresh session), never as a redirect. Sorted by plan_count descending. Params: `min_plans` (default 1), `after_date`, `before_date`, `project`, `host`.
- `hook-config-vs-observed`: hooks CONFIGURED on disk (plugin `hooks.json`, `~/.claude/settings.json`, `.claude/settings.json`) left-joined against DISTINCT hooks OBSERVED in `hook_events`, surfacing `observed_fires = 0` rows: hooks that never left a trace, the blind spot every other hook query misses because a silently-succeeding hook produces no event at all. Params: `after_date`, `before_date`, `project`, `host` (scopes the observed side only), `hook` (glob on configured command), `hook_config_glob` (override the plugin-cache glob).

### Markdown and YAML on Disk

Two queries read files on disk through community extensions instead of the index. They need `markdown`/`yaml` loaded, so run them with `-init resources/extensions.sql`, which loads both in the same process before the piped query and runs under `-readonly`. The common-path queries above omit `-init` and pay nothing.

```bash
duckdb -readonly -init ${CLAUDE_SKILL_DIR}/resources/extensions.sql "$DB" \
  < ${CLAUDE_SKILL_DIR}/resources/queries/plan-sections.sql
```

- `plan-sections`: one row per markdown section across plan files on disk, joined to the session that produced each plan (outcome, replan sequence). The glob self-defaults to `~/.claude/plans/*.md` and takes an optional `plans_glob` override. Reads plan structure rather than re-parsing headings by hand, e.g. "which plans have no Verification section":

  ```sql
  -- prepend SET VARIABLE plans_glob = '...'; to scope
  WITH s AS (
    SELECT file_path, bool_or(title = 'Verification') AS has_verification
    FROM read_markdown_sections('~/.claude/plans/*.md', filename=true)
    GROUP BY file_path
  )
  SELECT file_path FROM s WHERE NOT has_verification;
  ```

  Local-host caveat: plans are read from the local disk, so a `plan_calls.plan_file` from an imported host (or a deleted plan) has no file to read. The `LEFT JOIN` simply omits its sections, so session-side data is unaffected. Embedded `$.input.plan` (via `plan_calls.plan_chars` / `content_items`) stays the source for cross-host and point-in-time needs.
- `frontmatter`: one row per markdown file with YAML frontmatter, returning typed `name`/`description` and `content_chars`. The glob self-defaults to the memory corpus (`~/.claude/projects/*/memory/*.md`), where the nested `metadata` frontmatter auto-expands into a typed struct. Override with `frontmatter_glob` for skills, which live under `~/.claude/plugins` (not `~/.claude/skills`) and are duplicated across cache version-hashes, so pin one copy: `plugins/*/skills/*/SKILL.md` for repo skills.

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

## Tables and Views

Every table and view carries a `host` column (`local` for this machine, the label for imported ones). The `sessions` view adds `project_id` (`host || ':' || project_path`) for cross-host project identity.

- `raw`: one row per JSONL line, **every record type** (chat, attachments, system events, permission modes, titles, queue ops, snapshots, and more), not just user/assistant. Pinned scalar columns (`host`, `session_id`, `type`, `project_path`, `git_branch`, `is_meta`, `is_sidechain`, `duration_ms`, `timestamp`, `summary`, `input_tokens`, `output_tokens`, `source_file`, `source_line`) plus a `data JSON` column that holds the full original line. Pinned numerics use `TRY_CAST`, so a divergent value type yields NULL rather than failing the import.
- `records`: universal union over `raw`, one row per line, with a normalized `kind` label (`type`, plus `subtype`/attachment kind when present) and the cross-cutting dimensions (`uuid`, `parent_uuid`, `permission_mode`, `version`, `slug`, `is_meta`, `is_sidechain`) every record may carry, plus full `data`. The anti-blindness backbone: `SELECT kind, COUNT(*) FROM records GROUP BY kind` is the whole taxonomy; reach into `data->>'$.path'` for anything not pinned. Use the `fields` query to discover those paths.
- `attachments`: one row per `attachment` record (the richest non-chat category: hooks, diagnostics, skill/tool listings, plan/auto mode, queued commands, command permissions). Columns: `kind` (attachment subtype), `hook_name`, `hook_event`, `tool_use_id`, `attachment JSON` (full payload), `data`.
- `system_events`: one row per `system` record. `subtype`, `level`, `content`, `duration_ms`, `message_count`, and per-subtype fields: stop-hook (`hook_count`, `prevented_continuation`, `stop_reason`), compaction (`compact_trigger`, `compact_pre_tokens`, `compact_duration_ms`), API errors (`error_code`, `retry_attempt`).
- `hook_events`: one row per `hook_*` attachment (every event: PreToolUse, PostToolUse, Stop, SessionStart, UserPromptSubmit, PermissionRequest), with replayed lines deduped. `kind`, `hook_event`, `hook_name`, `command` (exact script; NULL for a `hook_blocking_error`), `exit_code`, `duration_ms`, `decision` (allow/ask/deny, parsed from the stdout JSON of a hook_success when the hook returns a permission decision), `reason`, `additional_context`, `blocked` (boolean), plus `stdout`/`stderr`/`content`/`blocking_error`.
- `hook_blocks`: the friction surface, `hook_events` filtered to events that stopped or interrupted a tool call or the model. `decision` is deny/ask/block; `reason` is the surfaced message. Find overfiring hooks here (high counts, repeated blocks within a session).
- `messages`: view over `raw` filtered to `type IN ('user', 'assistant')`, with a derived `content_text` (string-form messages only), `model`, token columns (`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`), attribution columns (`attribution_skill`, `attribution_plugin`, `attribution_agent`, `attribution_mcp_server`, `attribution_mcp_tool`), and a `summary` joined from summary rows.
- `message_usage`: one row per assistant message with deduped token columns (`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens` as MAX per message id), plus `model`, attribution columns, and `content_rows` (raw row count). **Sum tokens from here, not from `raw`/`messages`**: every content-block row repeats the parent message's usage, so per-row sums inflate totals 2-3.5x.
- `content_items`: one row per element of `data->'$.message.content'`, with pinned columns (`type`, `name`, `id`, `tool_use_id`, `text`, `content`, `is_error`), the parent's attribution (`attribution_skill`/`plugin`/`agent`), plus `data JSON` (the content item) and `tool_use_result JSON` (merged from the parent message). Replayed lines from session rewind/resume are deduped (by record uuid, then by tool id), so tool_use/tool_result counts are one row per event.
- `diagnostics`: one row per type-checker/linter/LSP diagnostic surfaced in-session. Columns: `file`, `severity`, `source`, `code`, `message`. Unnested from `diagnostics` attachments.
- `file_operations`: one row per `Read`/`Write`/`Edit`/`MultiEdit`/`NotebookEdit`, with `operation`, `file_path`, and attribution. What you work on, and under which skill/plugin/agent.
- `pr_links`: pull requests opened from a session. Columns: `pr_number`, `repository`, `url`, `session_id`. Join to `sessions` to connect work to shipped outcomes.
- `text_content`: one row per prose text item across user and assistant messages. Columns: `session_id`, `timestamp`, `role`, `model` (NULL for user), `project_path`, `text` (fenced and inline-backtick code stripped), `raw_text`, `source_file`, `source_line`.
- `sessions`: aggregated session-level stats (start/end time, duration, message counts).
- `tool_calls`: one row per tool use, with `file_path` and `command` (from the tool input) and attribution (`attribution_skill`/`plugin`/`agent`).
- `tool_errors`: tool results where `is_error` is true, joined with the originating tool call. `error_type` is `rejection` or `failure`.
- `permission_requests`: tool calls the user rejected.
- `sandbox_bypasses`: Bash calls that used `dangerouslyDisableSandbox=true`, with back-links to retried failures.
- `skill_calls`: one row per `Skill` tool invocation.
- `plan_calls`: one row per `ExitPlanMode` tool use. Columns: `tool_use_id`, `plan_file`, `plan_chars` (length of plan text; fetch the full text via `json_extract_string(data, '$.input.plan')` from `content_items` when needed), `outcome` (`approved` / `redirected` / `handoff` / `unknown`), `plan_seq` (1-based ordinal within the session). `handoff` is a rejection of the session's last plan with no file edits after it: the deliberate reject-and-implement-elsewhere workflow. `redirected` is any other rejection (mid-session churn).
- `plan_sessions`: one row per session that used plan mode. Columns: `plan_count`, `redirect_count`, `approved_count`, `handoff_count`, `unknown_count`, `first_plan_ts`, `last_plan_ts`.

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
