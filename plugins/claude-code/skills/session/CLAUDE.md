# Session Skill

## DuckDB Architecture

JSONL files in `~/.claude/projects/` are the canonical data. The DuckDB database is a derived cache. Other machines' corpora, copied under `~/.claude/session-imports/<label>/projects/`, are indexed under a `host` label alongside `local` (see SKILL.md "Cross-Machine History").

### Schema

`resources/schema/` runs on every startup:

- `01_tables.sql`: `raw` with pinned columns (`host` first) plus a `data JSON` blob, `meta(host, last_import)` holding a per-host import watermark, and `index_meta(version)` holding the ingestion schema version. The full pinned column set is declared upfront so the table type is stable across imports.
- `03_macros.sql`: filter macros for date ranges, project paths, and host, plus `project_id(host, path)`.

### Host enumeration

`db.ts` enumerates one entry per host: `local` (honoring `CLAUDE_PROJECTS_DIR` / the `projectsDir` option) plus one per `~/.claude/session-imports/*/manifest.json` (override the root with `CLAUDE_SESSION_IMPORTS_DIR` / the `importsDir` option). The filesystem is the registry; there is no host table. `ensureIndex` loops the hosts, setting `host` and `projects_glob` per iteration; `views.sql` runs once after the loop.

### Tables

- **`raw`**: pinned scalar columns (`host`, `session_id`, `type`, `project_path`, `git_branch`, `is_meta`, `is_sidechain`, `duration_ms`, `timestamp`, `summary`, `input_tokens`, `output_tokens`, `source_file`, `source_line`) plus `data JSON` holding the full original JSONL line. Imports use `read_json_objects(...)` (no auto-detected types beyond `json` itself), so column types never drift between imports. Ingestion does **not** filter by record type: every line lands in `raw` (chat, attachments, system events, permission modes, snapshots, etc.). The blindness this avoids was real: a prior `WHERE type IN ('user','assistant','summary')` silently dropped the entire structured layer (hook executions, compactions, permission modes). Pinned numerics use `TRY_CAST` so a divergent value type degrades to NULL instead of failing the whole import.
- **`records`**: universal view over `raw`, one row per line, projecting a normalized `kind` label and the cross-cutting dimensions every record may carry, plus `data`. This is the discoverable union: lossless storage (`raw.data`) plus a labeled surface so no record type is invisible. Query-time extraction over `data` (via the `fields` query's `json_keys`/`json_type` inference) is preferred over pinning more typed columns, which would reintroduce drift risk against divergent fields.
- **`messages`**: view over `raw` filtered to `type IN ('user', 'assistant')`, adding `content_text` (when message content is a string) and a joined `summary`.
- **`content_items`**: built from `raw` via `unnest(json_extract(data, '$.message.content[*]'))`. Pinned columns plus the content item's full `data JSON` plus the parent's `tool_use_result JSON`. No temp file roundtrip.

Chat views (`tool_calls`, `tool_errors`, `permission_requests`, `sandbox_bypasses`, `skill_calls`, `sessions`, `file_operations`) read from `messages` / `content_items`, which carry attribution (`attribution_skill`/`plugin`/`agent`) and token columns merged from the parent message. Structured views (`attachments`, `system_events`, `hook_events`, `hook_blocks`, `diagnostics`, `pr_links`) read from `raw` directly, extracting defensively with `->>` and `TRY_CAST` so type divergence never errors. `diagnostics` double-unnests the `files[].diagnostics[]` arrays of `diagnostics` attachments. `hook_events` parses a PreToolUse permission decision out of the stdout JSON of a `hook_success` record (where `hookSpecificOutput.permissionDecision` lives) and unwraps `hook_blocking_error`'s `{"blockingError": ...}` payload.

### Import pipeline

`refresh.sql` returns `changed_files` for the current host (those modified after that host's `last_import`, keyed by `host`). The watermark is per-host because `rsync -a` preserves source mtimes, so an imported host's files can predate `local`'s watermark; a shared watermark would skip them. `import.sql` runs `read_json_objects` on just those files (all record types, no `WHERE` filter), projects pinned columns with explicit `TRY_CAST`s (including `getvariable('host') AS host`), and updates `raw` via `UNION ALL` against the cached rows, deduping by `source_file` (`NOT (host = <host> AND source_file IN <reread files>)`) so other hosts' and other files' rows survive. Dedup keys on file, not `session_id`, because subagent files carry the parent session's id and some record types carry none: a session-scoped delete would drop unrelated rows or leave duplicates. It then upserts that host's `meta` row. The pinned schema means the cached `raw` and the freshly-built `new_raw` always have identical column types, so the union cannot fail with conversion errors.

After the per-host loop, `views.sql` rebuilds `content_items` and the views. No temp JSONL files, no `COPY TO` step. Cross-host joins key on `(host, session_id)`; the `content_items`/`messages` join keys on `(source_file, source_line)`, which is host-unique because imported files have distinct absolute paths.

### Migration

`db.ts` runs `migrateIfNeeded` after the warm-session marker check, before `applySchema`. It drops `raw`, `meta`, `content_items`, and `index_meta` when either the schema predates the `host`/`data` columns or the stored `index_meta.version` is older than `INDEX_VERSION` (bumped whenever ingestion must re-read every line rather than just newly-modified files, e.g. when it stopped filtering record types). The next `applySchema` recreates the pinned tables and `ensureSchema` stamps the current version; the empty `meta` forces a one-shot full reimport from JSONL. Warm sessions with a `.refreshed-<id>` marker skip migration entirely.

### JSON path gotcha

DuckDB parses `data->>'$.x' = 'y'` as `data->>('$.x' = 'y')` because `=` binds tighter than `->>`. Wrap `data->>'$.path'` in parens before any comparison or function call where this matters. The views in `views.sql` apply this convention; downstream queries in `resources/queries/` should too.

### Concurrency

`getDb` opens read-write, which takes an exclusive DuckDB file lock: only one read-write open succeeds at a time, so the writers (`refresh.ts`, `import.ts`, `forget.ts`, `hosts.ts`) must not run concurrently. Read-only opens take no lock and any number coexist, so the workflow fan-out pattern is "refresh once, then have every agent query with `duckdb -readonly` over the shared file" (documented in SKILL.md "Parallel queries"). This is why the query path is the bare `duckdb` CLI rather than a wrapper: a read-only file is all a caller needs, and a wrapper would force every parallel agent through it for no benefit.

### Callers

- `db.ts`: orchestrates migration, schema, refresh, import, views.
- `refresh.ts`: CLI entry point. Runs `ensureIndex`, prints DB path to stdout.
