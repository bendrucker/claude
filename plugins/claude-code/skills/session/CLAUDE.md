# Session Skill

## DuckDB Architecture

JSONL files in `~/.claude/projects/` are the canonical data. The DuckDB database is a derived cache living in the plugin data dir (`getDataDir` derives `~/.claude/plugins/data/<plugin>-<marketplace>/` from the script's installed location; `CLAUDE_PLUGIN_DATA` overrides it, and tests always set it). Dev runs from a bare checkout error without the override, so development never touches the live index. Other machines' corpora, copied under `~/.claude/session-imports/<label>/projects/`, are indexed under a `host` label alongside `local` (see SKILL.md "Cross-Machine History").

### Schema

`resources/schema/` runs on every startup:

- `01_tables.sql`: `raw` with pinned columns (`host` first) plus a `data JSON` blob, `indexed_files(host, path, mtime, size)` as the per-file change catalog, `meta(host, last_import)` as display metadata for `hosts.ts`, and `index_meta(version, views_hash)` holding the ingestion schema version and the fingerprint of `views.sql`. The full pinned column set is declared upfront so the table types are stable across imports.
- `03_macros.sql`: filter macros for date ranges, project paths, and host, `project_id(host, path)`, and the `model_input_rate`/`model_output_rate` cost-rate table the usage queries share. Macros must live here (the schema load path) to persist in the DB file for the read-only query CLI.

### Host Enumeration

`db.ts` enumerates one entry per host: `local` (honoring `CLAUDE_PROJECTS_DIR` / the `projectsDir` option) plus one per `~/.claude/session-imports/*/manifest.json` (override the root with `CLAUDE_SESSION_IMPORTS_DIR` / the `importsDir` option). The filesystem is the registry; there is no host table. `ensureIndex` loops the hosts, scanning each host's root in TypeScript and importing per file. A host whose root directory is missing is skipped, never treated as all-files-deleted, so a typo'd `CLAUDE_PROJECTS_DIR` or unmounted dir cannot wipe a host's rows. Any other scan failure (e.g. an unreadable subdirectory) aborts the refresh, because a partial listing is indistinguishable from mass deletion.

### Tables

- **`raw`**: pinned scalar columns (`host`, `session_id`, `type`, `project_path`, `git_branch`, `is_meta`, `is_sidechain`, `duration_ms`, `timestamp`, `summary`, `input_tokens`, `output_tokens`, `source_file`, `source_line`) plus `data JSON` holding the full original JSONL line. Imports use `read_json_objects(...)` (no auto-detected types beyond `json` itself), so column types never drift between imports. Ingestion does **not** filter by record type: every line lands in `raw` (chat, attachments, system events, permission modes, snapshots, etc.). The blindness this avoids was real: a prior `WHERE type IN ('user','assistant','summary')` silently dropped the entire structured layer (hook executions, compactions, permission modes). Pinned numerics use `TRY_CAST` so a divergent value type degrades to NULL instead of failing the whole import.
- **`records`**: universal view over `raw`, one row per line, projecting a normalized `kind` label and the cross-cutting dimensions every record may carry, plus `data`. This is the discoverable union: lossless storage (`raw.data`) plus a labeled surface so no record type is invisible. Query-time extraction over `data` (via the `fields` query's `json_keys`/`json_type` inference) is preferred over pinning more typed columns, which would reintroduce drift risk against divergent fields.
- **`messages`**: view over `raw` filtered to `type IN ('user', 'assistant')`, adding `content_text` (when message content is a string) and a joined `summary`.
- **`content_items`**: a table rebuilt by `views.sql` from `raw` via `unnest(json_extract(data, '$.message.content[*]'))`. Pinned columns plus the content item's full `data JSON` plus the parent's `tool_use_result JSON`. No temp file roundtrip. Session rewind/resume replays JSONL lines verbatim (same record uuid, usually later in the same file), so materialization dedupes twice: replayed source lines by `(host, session_id, uuid)` keeping the latest copy, then residual duplicate tool ids by `(host, type, id/tool_use_id)` (e.g. an Agent tool_use echoed into its subagent transcript under a fresh uuid). `attachments` and `hook_events` apply the same uuid-level dedupe. That second dedup pass is cross-file, which is why `content_items` stays a full rebuild rather than joining `raw`'s per-file incremental path: which copy of a duplicated tool id wins can depend on rows from a different file.

Chat views (`tool_calls`, `tool_errors`, `permission_requests`, `sandbox_bypasses`, `skill_calls`, `sessions`, `file_operations`) read from `messages` / `content_items`, which carry attribution (`attribution_skill`/`plugin`/`agent`) and token columns merged from the parent message. `message_usage` dedupes assistant usage to one row per message id (`MAX` per token column), because every content-block row repeats the parent message's cumulative usage; token-summing queries read from it instead of summing `raw`/`messages` rows. Structured views (`attachments`, `system_events`, `hook_events`, `hook_blocks`, `diagnostics`, `pr_links`) read from `raw` directly, extracting defensively with `->>` and `TRY_CAST` so type divergence never errors. `diagnostics` double-unnests the `files[].diagnostics[]` arrays of `diagnostics` attachments. `hook_events` parses a PreToolUse permission decision out of the stdout JSON of a `hook_success` record (where `hookSpecificOutput.permissionDecision` lives) and unwraps `hook_blocking_error`'s `{"blockingError": ...}` payload.

### Import Pipeline

`ensureIndex` scans each host's root for `*.jsonl` in TypeScript (`scanJsonlFiles`) and diffs it against `indexed_files`: a file is changed when its path is new or its (mtime, size) differs, and a vanished path drops its rows. This per-file catalog replaced a per-host mtime watermark, which had two holes: a write landing between scan and stamp was skipped forever, and `rsync -a` delivering a new file with an old preserved mtime was never indexed.

For each changed file, `import.sql` runs once inside a transaction: delete the file's `raw` rows, re-read it with `read_json_objects` (all record types, no `WHERE` filter, explicit `TRY_CAST`s), and upsert its `indexed_files` row. `source_line` comes from `ROW_NUMBER() OVER ()` on the single-file scan, which preserves file order in practice but is not formally guaranteed (documented caveat in SKILL.md "Source Lookup"). Dedup keys on file, not `session_id`, because subagent files carry the parent session's id and some record types carry none: a session-scoped delete would drop unrelated rows or leave duplicates.

The per-file delete-then-insert (instead of the previous whole-table `CREATE OR REPLACE ... UNION ALL` rewrite of `raw`) plus the `CHECKPOINT` at the end of every writing run is what bounds the file size: DuckDB only reuses freed blocks after a checkpoint and never returns space to the OS. `refresh.ts` adds a compaction guard on top: when the file exceeds 4x the corpus size (with a 64 MiB floor), it copies the database into a fresh file via `ATTACH` + `COPY FROM DATABASE` and atomically renames it into place.

`views.sql` (which also rebuilds the `content_items` table) runs after the host loop whenever `raw` changed, and additionally whenever its SHA-256 differs from `index_meta.views_hash`, so editing a view definition takes effect on the next refresh even with no changed files. Cross-host joins key on `(host, session_id)`; the `content_items`/`messages` join keys on `(source_file, source_line)`, which is host-unique because imported files have distinct absolute paths.

### Refresh Entry Point

`refresh.ts` prints the DB path to stdout (everything else goes to stderr). A `last-refresh` stamp file makes runs within `--max-age` (default 300s) print the path and exit before opening the database, so the fast path never takes a lock. `--refresh` bypasses the stamp. On a lock conflict it retries briefly, then defers to the concurrent refresher and exits 0 with the path. It also sweeps the pre-plugin-data stray indexes under `$TMPDIR/claude-session` and `/tmp/claude-session`, only when running against the derived production data dir.

### Migration

`db.ts` runs `migrateIfNeeded` before `applySchema`. It drops `raw`, `content_items`, `indexed_files`, `meta`, and `index_meta` when either the schema predates the `host`/`data` columns or the stored `index_meta.version` is older than `INDEX_VERSION` (bumped whenever ingestion must re-read every line, e.g. v3's per-file catalog and incremental `content_items`). The next `applySchema` recreates the pinned tables and the empty `indexed_files` forces a one-shot full reimport from JSONL.

### JSON Path Gotcha

DuckDB parses `data->>'$.x' = 'y'` as `data->>('$.x' = 'y')` because `=` binds tighter than `->>`. Wrap `data->>'$.path'` in parens before any comparison or function call where this matters. The views in `views.sql` apply this convention; downstream queries in `resources/queries/` should too.

### Concurrency

`getDb` opens read-write, which needs an exclusive DuckDB file lock: the writers (`refresh.ts` past its stamp, `import.ts`, `forget.ts`, `hosts.ts`) must not run concurrently with each other or with readers. Read-only opens take a shared lock: any number coexist, but none can open mid-refresh and a refresh cannot start while readers hold the file. Either collision fails with `Could not set lock`. The workflow fan-out pattern is therefore "refresh once, then have every agent query with `duckdb -readonly` over the shared file" (documented in SKILL.md "Parallel Queries"). This is why the query path is the bare `duckdb` CLI rather than a wrapper: a read-only open at the stable path is all a caller needs, and a wrapper would force every parallel agent through it for no benefit.

### Callers

- `db.ts`: orchestrates migration, schema, scan, per-file import, view rebuild and versioning, checkpoint, compaction.
- `refresh.ts`: CLI entry point. Stamp fast-path, `ensureIndex`, compaction guard, prints DB path to stdout.

### Development

`getDataDir` errors outside an installed plugin, so any dev invocation (tests, manual runs from the repo checkout) must set `CLAUDE_PLUGIN_DATA`, typically to a temp dir. `bun test` covers this via per-test `mkdtemp` dirs.
