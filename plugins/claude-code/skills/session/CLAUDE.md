# Session Skill

## DuckDB Architecture

The session skill indexes JSONL session files from `~/.claude/projects/` into a persistent DuckDB database. The JSONL files are the canonical data store: the database is a derived cache.

### Schema and Queries

`resources/schema/` contains ordered DDL files run on every startup. `resources/queries/` contains parameterized SQL used by tests. The `query.sh` script runs arbitrary SQL directly against the index.

`import.sql` inserts into `messages` using `getvariable('source')` to resolve the file source. `query.sh` sets the `source` variable (to a file list for incremental refresh, or an empty file to skip) before executing the import.

### Adding Columns

To add a new column to `messages`:

1. Add the column to `01_tables.sql`
2. Update `import.sql` to populate the column during import
3. Update `query.sh` inline refresh logic if needed
