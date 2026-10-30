# Parallel Query Workflows

Fan-out investigations of the session corpus: a breadth pass for leads, then a depth pass per lead. The orchestrator refreshes once, and every agent reads the index read-only.

## Scoping Params From the CLI

A named query with an unset param runs unfiltered. Prepend `SET VARIABLE` lines to scope it, substituting `<db-path>` and `<skill-dir>` from `SKILL.md`:

```bash
duckdb -readonly -json -init <skill-dir>/resources/limits.sql <db-path> <<'SQL'
SET VARIABLE after_date = '2026-05-01';
SET VARIABLE hook = '*tropes*';
.read <skill-dir>/resources/queries/hook-blocks.sql
SQL
```

## Breadth-First Leads

Take leads from the survey surfaces: the `records` taxonomy, the `fields` registry, `activity`, `hooks`, `diagnostics`, and `skill-activity`. Then write custom read-only SQL over whatever table or view the survey pointed at.
