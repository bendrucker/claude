# Session Skill

## DuckDB Architecture

JSONL files in `~/.claude/projects/` are the canonical data. The DuckDB database is a derived cache.

### Schema

`resources/schema/` contains ordered DDL files run on every startup:

- `01_tables.sql`: Bootstrap `raw` (minimal schema, replaced on import) and `meta` (import timestamps)
- `03_macros.sql`: Filter macros for date ranges and project paths

### Tables

- **`raw`**: Rebuilt from disk on every import via a single `read_ndjson` over the full `projects_glob`. `refresh.sql` short-circuits the import when nothing has changed since `last_import`, but when it does run, `raw` is fully replaced — never `UNION`-ed with cached rows. This avoids cross-run column type drift (e.g., a column inferred as `VARCHAR` in one run and `JSON` in the next), which would fail the union cast.
- **`messages`**: Built from `raw` via `* EXCLUDE` pass-through + snake_case renames. One row per message.
- **`content_items`**: Built from a temp JSONL file via `read_ndjson` auto-detect. Each content array element is written with parent context merged in. Schema is fully auto-detected.

Views (`tool_calls`, `tool_errors`, `sessions`) query these tables.

### Import pipeline

`import.sql` flattens `message.*` into `raw`. Only `message.content` is explicitly aliased to `message_content`; the rest of `message.*` expands via `EXCLUDE (content)`. When message fields collide with top-level fields (e.g., `type`, `id`, `container`), DuckDB auto-suffixes them (`type_1`, `id_1`, etc.). This avoids `EXCLUDE` on optional message fields, which fails when they're absent from the struct.

`source_line` uses `ROW_NUMBER() OVER (PARTITION BY filename)` so it preserves per-file 1-based line numbers — needed by the `sed -n '<source_line>p' <source_file>` lookup pattern documented in `SKILL.md`.

After rebuilding `raw`, `import.sql` creates a `content_items_export` temp table. Callers must COPY this to `${data_dir}/content_items.jsonl` and DROP it before running `views.sql`. DuckDB's `COPY TO` requires a literal path, so this step cannot live in SQL alone.

`views.sql` reads the temp file back via `read_ndjson(getvariable('data_dir') || '/content_items.jsonl')` and creates `content_items`, `messages`, and downstream views.

### Callers

- `db.ts`: Sets `data_dir` variable, orchestrates import → COPY → views via separate `db.run()` calls
- `query.ts`: CLI entry point, uses `db.ts` functions directly
