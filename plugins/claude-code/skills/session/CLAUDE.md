# Session Skill

## DuckDB Architecture

The session CLI indexes JSONL session files from `~/.claude/projects/` into a persistent DuckDB database. The JSONL files are the canonical data store: the database is a derived cache.

### Schema and Queries

`resources/schema/` contains ordered DDL files run on every startup. `resources/queries/` contains parameterized SQL for each subcommand. Queries read from views, not from `messages` directly.

`import.sql` inserts into `messages` using `getvariable('source')` to resolve the file source. `db.ts` sets the `source` variable (to a glob for full import, or a file list for incremental refresh) before executing the import.

### Adding Columns

To add a new column to `messages`:

1. Add the column to `01_messages.sql` (for new databases)
2. Create a new schema file (e.g., `05_add_foo.sql`):
   ```sql
   ALTER TABLE messages ADD COLUMN IF NOT EXISTS foo VARCHAR;
   UPDATE messages SET foo = (
     SELECT json_extract_string(r.message, '$.foo')
     FROM read_ndjson('~/.claude/projects/**/*.jsonl', ...) r
     WHERE r.sessionId = messages.session_id
   );
   ```
3. Update `import.sql` to populate the column for new imports
