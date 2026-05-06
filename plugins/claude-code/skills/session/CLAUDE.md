# Session Skill

## DuckDB Architecture

JSONL files in `~/.claude/projects/` are the canonical data. The DuckDB database is a derived cache.

### Schema

`resources/schema/` runs on every startup:

- `01_tables.sql`: `raw` with pinned columns plus a `data JSON` blob, and `meta` with `last_import`. The full pinned column set is declared upfront so the table type is stable across imports.
- `03_macros.sql`: filter macros for date ranges and project paths.

### Tables

- **`raw`**: pinned scalar columns (`session_id`, `type`, `project_path`, `git_branch`, `is_meta`, `is_sidechain`, `duration_ms`, `timestamp`, `summary`, `input_tokens`, `output_tokens`, `source_file`, `source_line`) plus `data JSON` holding the full original JSONL line. Imports use `read_json_objects(...)` (no auto-detected types beyond `json` itself), so column types never drift between imports.
- **`messages`**: view over `raw` filtered to `type IN ('user', 'assistant')`, adding `content_text` (when message content is a string) and a joined `summary`.
- **`content_items`**: built from `raw` via `unnest(json_extract(data, '$.message.content[*]'))`. Pinned columns plus the content item's full `data JSON` plus the parent's `tool_use_result JSON`. No temp file roundtrip.

Other views (`tool_calls`, `tool_errors`, `permission_requests`, `sandbox_bypasses`, `skill_calls`, `sessions`) read from `messages` / `content_items`.

### Import pipeline

`refresh.sql` returns `changed_files` (those modified after `last_import`). `import.sql` runs `read_json_objects` on just those files, projects pinned columns with explicit casts, and updates `raw` via `UNION ALL BY NAME` against the cached rows from sessions not in `changed_sessions`. The pinned schema means the cached `raw` and the freshly-built `new_raw` always have identical column types, so the union cannot fail with conversion errors.

After `import.sql`, `views.sql` rebuilds `content_items` and the views. No temp JSONL files, no `COPY TO` step.

### Migration

`db.ts` runs `migrateIfNeeded` after the warm-session marker check, before `applySchema`. If `raw.data` is missing (the old auto-detected schema), it drops `raw`, `meta`, `messages`, and `content_items`. The next `applySchema` recreates the pinned tables, and the empty `meta` forces a one-shot full reimport from JSONL. Warm sessions with a `.refreshed-<id>` marker skip migration entirely.

### JSON path gotcha

DuckDB parses `data->>'$.x' = 'y'` as `data->>('$.x' = 'y')` because `=` binds tighter than `->>`. Wrap `data->>'$.path'` in parens before any comparison or function call where this matters. The views in `views.sql` apply this convention; downstream queries in `resources/queries/` should too.

### Callers

- `db.ts`: orchestrates migration, schema, refresh, import, views.
- `query.ts`: CLI entry point.
