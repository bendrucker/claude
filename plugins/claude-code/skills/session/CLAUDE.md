# Session Skill

## DuckDB Architecture

JSONL files in `~/.claude/projects/` are the canonical data. The DuckDB database is a derived cache. Other machines' corpora, copied under `~/.claude/session-imports/<label>/projects/`, are indexed under a `host` label alongside `local` (see SKILL.md "Cross-Machine History").

### Schema

`resources/schema/` runs on every startup:

- `01_tables.sql`: `raw` with pinned columns (`host` first) plus a `data JSON` blob, and `meta(host, last_import)` holding a per-host import watermark. The full pinned column set is declared upfront so the table type is stable across imports.
- `03_macros.sql`: filter macros for date ranges, project paths, and host, plus `project_id(host, path)`.

### Host enumeration

`db.ts` enumerates one entry per host: `local` (honoring `CLAUDE_PROJECTS_DIR` / the `projectsDir` option) plus one per `~/.claude/session-imports/*/manifest.json` (override the root with `CLAUDE_SESSION_IMPORTS_DIR` / the `importsDir` option). The filesystem is the registry; there is no host table. `ensureIndex` loops the hosts, setting `host` and `projects_glob` per iteration; `views.sql` runs once after the loop.

### Tables

- **`raw`**: pinned scalar columns (`host`, `session_id`, `type`, `project_path`, `git_branch`, `is_meta`, `is_sidechain`, `duration_ms`, `timestamp`, `summary`, `input_tokens`, `output_tokens`, `source_file`, `source_line`) plus `data JSON` holding the full original JSONL line. Imports use `read_json_objects(...)` (no auto-detected types beyond `json` itself), so column types never drift between imports.
- **`messages`**: view over `raw` filtered to `type IN ('user', 'assistant')`, adding `content_text` (when message content is a string) and a joined `summary`.
- **`content_items`**: built from `raw` via `unnest(json_extract(data, '$.message.content[*]'))`. Pinned columns plus the content item's full `data JSON` plus the parent's `tool_use_result JSON`. No temp file roundtrip.

Other views (`tool_calls`, `tool_errors`, `permission_requests`, `sandbox_bypasses`, `skill_calls`, `sessions`) read from `messages` / `content_items`.

### Import pipeline

`refresh.sql` returns `changed_files` for the current host (those modified after that host's `last_import`, keyed by `host`). The watermark is per-host because `rsync -a` preserves source mtimes, so an imported host's files can predate `local`'s watermark; a shared watermark would skip them. `import.sql` runs `read_json_objects` on just those files, projects pinned columns with explicit casts (including `getvariable('host') AS host`), and updates `raw` via `UNION ALL` against the cached rows, deduping host-scoped (`NOT (host = <host> AND session_id IN changed_sessions)`) so other hosts' rows survive. It then upserts that host's `meta` row. The pinned schema means the cached `raw` and the freshly-built `new_raw` always have identical column types, so the union cannot fail with conversion errors.

After the per-host loop, `views.sql` rebuilds `content_items` and the views. No temp JSONL files, no `COPY TO` step. Cross-host joins key on `(host, session_id)`; the `content_items`/`messages` join keys on `(source_file, source_line)`, which is host-unique because imported files have distinct absolute paths.

### Migration

`db.ts` runs `migrateIfNeeded` after the warm-session marker check, before `applySchema`. If `raw.data` or `raw.host` is missing (a pre-host schema), it drops `raw`, `meta`, and `content_items`. The next `applySchema` recreates the pinned tables, and the empty `meta` forces a one-shot full reimport from JSONL. Warm sessions with a `.refreshed-<id>` marker skip migration entirely.

### JSON path gotcha

DuckDB parses `data->>'$.x' = 'y'` as `data->>('$.x' = 'y')` because `=` binds tighter than `->>`. Wrap `data->>'$.path'` in parens before any comparison or function call where this matters. The views in `views.sql` apply this convention; downstream queries in `resources/queries/` should too.

### Callers

- `db.ts`: orchestrates migration, schema, refresh, import, views.
- `refresh.ts`: CLI entry point. Runs `ensureIndex`, prints DB path to stdout.
