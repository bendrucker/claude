# Session Skill

## DuckDB Architecture

The session skill indexes JSONL session files from `~/.claude/projects/` into a persistent DuckDB database. The JSONL files are the canonical data store: the database is a derived cache.

### Schema

`resources/schema/` contains ordered DDL files run on every startup:

- `01_tables.sql`: The `raw` table stores one row per JSONL line with the `message` struct flattened (model, usage, stop_reason, content). `read_ndjson` auto-detects the JSONL schema — the `raw` columns are a curated subset.
- `03_macros.sql`: Reusable filter macros for date ranges and project paths.

`views.sql` (outside `schema/`, run after import) renames camelCase→snake_case and unnests `message.content` arrays into individual rows. Downstream views (`sessions`, `tool_calls`, `tool_errors`) query `messages`.

### Import

`import.sql` reads JSONL files via `read_ndjson` with `union_by_name=true` for auto-detection, selects the `raw` table columns using struct access for `message` fields, and inserts directly. `query.sh` determines changed files via mtime comparison, skipping the import when no files changed. `db.ts` uses a similar approach but returns early when no files changed.

### Adding Columns

To expose a new JSONL field in queries:

- Add the column to `01_tables.sql` and the corresponding select expression to `import.sql`
- Add the column to the `messages` view in `views.sql` if it should be available downstream
- Ensure at least one test fixture includes the field for auto-detection
