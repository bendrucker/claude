# Session Skill

## DuckDB Architecture

The session skill indexes JSONL session files from `~/.claude/projects/` into a persistent DuckDB database. The JSONL files are the canonical data store: the database is a derived cache.

### Schema

`resources/schema/` contains ordered DDL files run on every startup:

- `01_tables.sql`: Bootstrap `raw` table (minimal schema, replaced on import) and `meta` table for tracking import timestamps.
- `03_macros.sql`: Reusable filter macros for date ranges and project paths.

`views.sql` (outside `schema/`, run after import) materializes the `messages` table from `raw` — renames camelCase→snake_case, unnests `message.content` arrays into individual rows, and creates downstream views (`sessions`, `tool_calls`, `tool_errors`).

### Import

`import.sql` reads JSONL files via `read_ndjson` with `union_by_name=true` for auto-detection and `message.*` for struct flattening. New JSONL fields flow into `raw` automatically without schema changes. The `messages` table schema is derived from `raw` via `CREATE OR REPLACE TABLE` — no hand-managed column definitions.

`query.sh` determines changed files via mtime comparison, skipping the import when no files changed. `db.ts` uses a similar approach but returns early when no files changed.
