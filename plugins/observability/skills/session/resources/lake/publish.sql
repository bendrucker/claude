-- One publish: the files whose (mtime, size) differ from the last publish, and every
-- session they touch before or after the change, replaced in one DuckLake commit.
--
-- The caller attaches the local index as `idx` (read-only) and the lake as `lake`, sets
-- VARIABLE hosts to the hosts to publish, and runs this from a scratch directory, where
-- it writes the generated statements it then reads back.
--
-- raw and file_fields replace per changed file. Every other table keys on
-- (host, session_id) and replaces per touched session, except the few with no
-- session_id, which replace whole. Views publish as tables, so a reader's projection
-- skips the JSON they parse.

.bail on
.mode list
.headers off

CALL lake.set_option('parquet_row_group_size', '8192');

-- A refresh that died between writing raw and rebuilding its derived tables leaves
-- views_hash NULL, and its content_items would not match its raw.
SELECT CASE WHEN (SELECT bool_or(views_hash IS NULL) FROM idx.index_meta)
  THEN error('The index is mid-rebuild (views_hash is NULL); refresh it before publishing.') END;

-- classifier_verdicts reads mod_events, local telemetry that is never published.
CREATE TEMP TABLE plan AS
WITH cols AS (
  SELECT table_name AS name, list(column_name) AS cols
  FROM duckdb_columns() WHERE database_name = 'idx' GROUP BY ALL
),
objects AS (
  SELECT table_name AS name FROM duckdb_tables()
  WHERE database_name = 'idx'
    AND table_name IN ('raw', 'file_fields', 'content_items', 'search_items', 'meta', 'index_meta')
  UNION ALL
  SELECT view_name FROM duckdb_views()
  WHERE database_name = 'idx' AND NOT internal AND view_name <> 'classifier_verdicts'
)
SELECT
  name,
  CASE
    WHEN name IN ('raw', 'file_fields') THEN 'file'
    WHEN list_contains(cols, 'session_id') THEN 'session'
    ELSE 'whole'
  END AS kind,
  list_contains(cols, 'session_id') AS has_session,
  list_contains(cols, 'host') AS has_host,
  list_contains(cols, 'source_file') AS has_file,
  list_contains(cols, 'timestamp') AS has_ts,
  -- Clustering by record type first lets a filter on a rare type skip the row groups
  -- of every other type, and a window still prunes within each type's run.
  CASE
    WHEN list_contains(cols, 'timestamp')
      THEN CASE WHEN list_contains(cols, 'type') THEN 'type, ' ELSE '' END || 'timestamp NULLS FIRST, host'
    WHEN list_contains(cols, 'session_id') THEN 'host, session_id'
    WHEN list_contains(cols, 'source_file') THEN 'host, source_file'
    ELSE NULL
  END AS sort
FROM objects JOIN cols USING (name);

-- The lake rebuilds from scratch when it is missing a table the index has, when a
-- table's columns differ, or when the index's own stamp moved: a views.sql or
-- projection change rewrites rows of files whose stats never changed.
SET VARIABLE existed = (
  SELECT count(*) > 0 FROM duckdb_tables() WHERE database_name = 'lake' AND table_name = 'published_files'
);
CREATE TABLE IF NOT EXISTS lake.index_meta AS FROM idx.index_meta WITH NO DATA;
CREATE TEMP TABLE shapes AS
SELECT
  database_name AS db,
  CASE WHEN database_name = 'idx' AND table_name = 'indexed_files' THEN 'published_files' ELSE table_name END AS name,
  string_agg(column_name || ' ' || data_type, ', ' ORDER BY column_index) AS shape
FROM duckdb_columns() WHERE database_name IN ('idx', 'lake') GROUP BY ALL;
SET VARIABLE rebuild = getvariable('existed') AND (
  EXISTS (
    SELECT 1 FROM (SELECT name FROM plan UNION ALL SELECT 'published_files') p
    LEFT JOIN shapes i ON i.db = 'idx' AND i.name = p.name
    LEFT JOIN shapes l ON l.db = 'lake' AND l.name = p.name
    WHERE l.shape IS DISTINCT FROM i.shape
  )
  OR (SELECT list(row(version, views_hash, import_hash)) FROM lake.index_meta)
    IS DISTINCT FROM (SELECT list(row(version, views_hash, import_hash)) FROM idx.index_meta)
);

BEGIN;

.once ddl.sql
SELECT format('DROP TABLE lake.{};', table_name) FROM duckdb_tables()
WHERE database_name = 'lake' AND getvariable('rebuild');
.read ddl.sql

CREATE TABLE IF NOT EXISTS lake.published_files AS FROM idx.indexed_files WITH NO DATA;
.once ddl.sql
SELECT format('CREATE TABLE IF NOT EXISTS lake.{0} AS FROM idx.{0} WITH NO DATA;', name) FROM plan;
-- Monthly partitions let a republish skip the files of months its sessions never reach,
-- and leave older months' files unchanged once their sessions end. Repeating it is a no-op.
SELECT format('ALTER TABLE lake.{} SET PARTITIONED BY (year(timestamp), month(timestamp));', name)
FROM plan WHERE has_ts;
.read ddl.sql
-- The earliest timestamp each published session holds, which bounds its rows' months.
CREATE TABLE IF NOT EXISTS lake.published_sessions (host VARCHAR, session_id VARCHAR, since TIMESTAMP);

CREATE TEMP TABLE changed AS
WITH now AS (FROM idx.indexed_files WHERE list_contains(getvariable('hosts'), host))
SELECT host, path AS source_file FROM (FROM now EXCEPT FROM lake.published_files)
UNION
SELECT host, path FROM (FROM lake.published_files EXCEPT FROM now);

-- Every filter on a set of keys is a plain IN on one column, which DuckDB pushes into the
-- scan, plus the exact tuple. A tuple or coalesce alone filters only after the view has
-- computed every row. Rows without a session are replaced by file.
CREATE TEMP TABLE touched AS
WITH r AS (
  FROM idx.raw SELECT host, session_id, source_file
  UNION ALL
  FROM lake.raw SELECT host, session_id, source_file
)
SELECT DISTINCT host, session_id FROM r
WHERE session_id IS NOT NULL
  AND source_file IN (SELECT source_file FROM changed)
  AND (host, source_file) IN (SELECT (host, source_file) FROM changed);

-- A session's rows in the lake all fall at or after its earliest published timestamp, or
-- have none. A session the lake has never seen has no rows to delete.
SET VARIABLE since = coalesce((
  SELECT min(since) FROM lake.published_sessions
  WHERE (host, session_id) IN (SELECT (host, session_id) FROM touched)
), 'infinity'::TIMESTAMP);

-- Each insert evaluates its view and sorts its rows in memory, so a first publish goes in
-- batches of about 512 MB of raw text, ordered by session start.
CREATE TEMP TABLE batches AS
SELECT host, session_id,
  coalesce(floor(sum(bytes) OVER (ORDER BY first_ts NULLS FIRST, host, session_id) / (512 * 1024 * 1024)), 0)::INTEGER AS batch
FROM (
  SELECT host, session_id, min(timestamp) AS first_ts, sum(strlen(data::VARCHAR)) AS bytes
  FROM idx.raw
  WHERE list_contains(getvariable('hosts'), host)
    AND session_id IN (SELECT session_id FROM touched)
    AND (host, session_id) IN (SELECT (host, session_id) FROM touched)
  GROUP BY ALL
);

-- A correlated EXISTS plans as a delim join that buffers every row of the outer table,
-- payload included, so the filters are uncorrelated IN lists. Nothing is written when
-- nothing changed.
CREATE TEMP MACRO in_sessions(src) AS format(
  'session_id IN (SELECT session_id FROM {0}) AND (host, session_id) IN (SELECT (host, session_id) FROM {0})', src);
.once dml.sql
WITH
  f AS (SELECT 'source_file IN (SELECT source_file FROM changed) AND (host, source_file) IN (SELECT (host, source_file) FROM changed)' AS in_files),
  h AS (SELECT 'list_contains(getvariable(''hosts''), host)' AS allowed),
  b AS (SELECT DISTINCT batch FROM batches),
  steps AS (
    SELECT 1 AS step, 0 AS batch, name, format('DELETE FROM lake.{} WHERE {};', name, in_files) AS sql
    FROM plan, f WHERE kind = 'file'
    UNION ALL
    SELECT 2, 0, name, format('DELETE FROM lake.{} WHERE {}{};', name, in_sessions('touched'),
      CASE WHEN has_ts THEN ' AND (timestamp >= getvariable(''since'') OR timestamp IS NULL)' ELSE '' END)
    FROM plan WHERE kind = 'session'
    UNION ALL
    SELECT 2, 0, name, format('DELETE FROM lake.{} WHERE session_id IS NULL AND {};', name, in_files)
    FROM plan, f WHERE kind = 'session' AND has_file
    UNION ALL
    SELECT 3, 0, name, format('INSERT INTO lake.{0} FROM idx.{0} WHERE {1} AND {2} ORDER BY {3};', name, in_files, allowed, sort)
    FROM plan, f, h WHERE kind = 'file' AND NOT has_session
    UNION ALL
    SELECT 3, 0, name, format('INSERT INTO lake.{0} FROM idx.{0} WHERE session_id IS NULL AND {1} AND {2} ORDER BY {3};',
      name, in_files, allowed, sort)
    FROM plan, f, h WHERE has_session AND has_file
    UNION ALL
    SELECT 4, b.batch, name, format('INSERT INTO lake.{0} FROM idx.{0} WHERE {1} AND {2} ORDER BY {3};',
      name, CASE WHEN kind = 'file' THEN in_files ELSE allowed END,
      in_sessions(format('(FROM batches WHERE batch = {})', b.batch)), sort)
    FROM plan, f, h, b WHERE kind = 'session' OR (kind = 'file' AND has_session)
    UNION ALL
    SELECT 5, 0, name, format('DELETE FROM lake.{0}; INSERT INTO lake.{0} FROM idx.{0}{1};',
      name, CASE WHEN has_host THEN ' WHERE ' || allowed ELSE '' END)
    FROM plan, h WHERE kind = 'whole'
  )
SELECT sql FROM steps
WHERE (SELECT count(*) > 0 FROM changed) OR getvariable('rebuild') OR NOT getvariable('existed')
ORDER BY step, batch, name;
.read dml.sql

DELETE FROM lake.published_sessions WHERE (host, session_id) IN (SELECT (host, session_id) FROM touched);
INSERT INTO lake.published_sessions
SELECT host, session_id, min(timestamp) FROM idx.raw
WHERE list_contains(getvariable('hosts'), host)
  AND session_id IN (SELECT session_id FROM touched)
  AND (host, session_id) IN (SELECT (host, session_id) FROM touched)
GROUP BY ALL;

DELETE FROM lake.published_files WHERE (host, path) IN (SELECT (host, source_file) FROM changed);
INSERT INTO lake.published_files
SELECT f.* FROM idx.indexed_files f JOIN changed c ON c.host = f.host AND c.source_file = f.path
WHERE list_contains(getvariable('hosts'), f.host);

-- Macros live in the lake's catalog, so a reader needs only the attach. The table macros
-- that read the refresh's scope tables stay local. published_macros keeps the definition
-- each was created from, since DuckDB does not print a macro back identically.
CREATE TABLE IF NOT EXISTS lake.published_macros (name VARCHAR, definition VARCHAR);
CREATE TEMP TABLE macros AS
SELECT i.function_name AS name, i.macro_definition AS definition,
  format('CREATE OR REPLACE MACRO lake.{}({}) AS {}{};', i.function_name,
    array_to_string(i.parameters, ', '), CASE WHEN i.function_type = 'table_macro' THEN 'TABLE ' ELSE '' END,
    i.macro_definition) AS sql
FROM duckdb_functions() i
LEFT JOIN lake.published_macros p ON p.name = i.function_name
WHERE i.database_name = 'idx' AND i.function_type IN ('macro', 'table_macro') AND NOT i.internal
  AND i.function_name NOT IN ('content_item_rows', 'search_item_rows', 'field_rows')
  AND p.definition IS DISTINCT FROM i.macro_definition;
DELETE FROM lake.published_macros WHERE name IN (SELECT name FROM macros);
INSERT INTO lake.published_macros SELECT name, definition FROM macros;
-- A table macro binds its tables when created, so these resolve names in the lake.
USE lake;
.once macros.sql
SELECT sql FROM macros;
.read macros.sql

SET VARIABLE result = json_object(
  'files', (SELECT count(*) FROM changed),
  'sessions', (SELECT count(*) FROM touched),
  'macros', (SELECT count(*) FROM macros),
  'rebuilt', getvariable('rebuild')
);
COMMIT;
SELECT getvariable('result');
