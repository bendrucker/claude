# Session Skill

## DuckDB Architecture

The session skill indexes JSONL session files from `~/.claude/projects/` into a persistent DuckDB database. The JSONL files are the canonical data store: the database is a derived cache.

### Schema and Queries

`resources/schema/` contains ordered DDL files run on every startup. `resources/queries/` contains parameterized SQL used by tests. The `query.sh` script runs arbitrary SQL directly against the index.

`import.sql` inserts into `messages` using `getvariable('source')` to resolve the file source. `query.sh` determines changed files via mtime comparison, then sets `source` to either the changed file list or an empty JSONL file (producing zero imported rows). `db.ts` uses a similar approach but returns early when no files changed.

### Adding Columns

To add a new column to `messages`:

- Add the column to `01_tables.sql`
- Update `import.sql` to populate the column during import
- Update `query.sh` inline refresh logic if needed
