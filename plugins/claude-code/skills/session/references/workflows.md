# Parallel Query Workflows

Worked pattern for fan-out investigations of the session corpus: breadth search for leads, then a depth pass per lead. Read [`SKILL.md`](../SKILL.md) "Parallel Queries (Workflows)" first for the refresh-once/read-only rule this extends.

## Scoping Params From the CLI

`getvariable` returns NULL for an unset variable and every named query null-guards its params, so a bare read-only run of a query file runs unfiltered. Prepend `SET VARIABLE` lines to scope it. Substitute `<db-path>` with the database path and `<skill-dir>` with the skill directory path, both from `SKILL.md`:

```bash
duckdb -readonly -json <db-path> <<'SQL'
SET VARIABLE after_date = '2026-05-01';
SET VARIABLE hook = '*tropes*';
.read <skill-dir>/resources/queries/hook-blocks.sql
SQL
```

## Breadth-First Leads

Breadth-first leads come from the survey surfaces (`records` taxonomy, `fields` for schema inference, `activity`, `hooks`, `diagnostics`, `skill-activity`). A depth pass is then custom read-only SQL over whatever table or view the survey pointed at.
