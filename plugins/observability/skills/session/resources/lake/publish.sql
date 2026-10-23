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
.read ddl.sql

CREATE TEMP TABLE changed AS
WITH now AS (FROM idx.indexed_files WHERE list_contains(getvariable('hosts'), host))
SELECT host, path AS source_file FROM (FROM now EXCEPT FROM lake.published_files)
UNION
SELECT host, path FROM (FROM lake.published_files EXCEPT FROM now);

CREATE TEMP TABLE touched AS
SELECT DISTINCT host, session_id FROM idx.raw JOIN changed USING (host, source_file)
UNION
SELECT DISTINCT host, session_id FROM lake.raw JOIN changed USING (host, source_file);

-- Each insert evaluates its view and sorts its rows in memory, so a first publish goes in
-- batches of about 512 MB of raw text, ordered by session start.
CREATE TEMP TABLE batches AS
SELECT host, session_id,
  coalesce(floor(sum(bytes) OVER (ORDER BY first_ts NULLS FIRST, host, session_id) / (512 * 1024 * 1024)), 0)::INTEGER AS batch
FROM (
  SELECT host, session_id, min(timestamp) AS first_ts, sum(strlen(data::VARCHAR)) AS bytes
  FROM idx.raw
  WHERE list_contains(getvariable('hosts'), host)
    AND (host, coalesce(session_id, '')) IN (SELECT (host, coalesce(session_id, '')) FROM touched)
  GROUP BY ALL
);

-- A correlated EXISTS plans as a delim join that buffers every row of the outer table,
-- payload included, so the filters are uncorrelated IN lists. coalesce keeps records
-- without a session in their own group.
.once dml.sql
WITH
  f AS (SELECT '(host, source_file) IN (SELECT (host, source_file) FROM changed)' AS in_files),
  h AS (SELECT 'list_contains(getvariable(''hosts''), host)' AS allowed),
  s AS (SELECT '(host, coalesce(session_id, '''')) IN (SELECT (host, coalesce(session_id, '''')) FROM ' AS in_sessions),
  b AS (SELECT DISTINCT batch FROM batches),
  steps AS (
    SELECT 1 AS step, 0 AS batch, name, format('DELETE FROM lake.{} WHERE {};', name, in_files) AS sql
    FROM plan, f WHERE kind = 'file'
    UNION ALL
    SELECT 2, 0, name, format('DELETE FROM lake.{} WHERE {}touched);', name, in_sessions)
    FROM plan, s WHERE kind = 'session'
    UNION ALL
    SELECT 3, 0, name, format('INSERT INTO lake.{0} FROM idx.{0} WHERE {1} AND {2} ORDER BY {3};', name, in_files, allowed, sort)
    FROM plan, f, h WHERE kind = 'file' AND NOT has_session
    UNION ALL
    SELECT 4, b.batch, name, format(
      'INSERT INTO lake.{0} FROM idx.{0} WHERE {1} AND {2}batches WHERE batch = {3}) ORDER BY {4};',
      name, CASE WHEN kind = 'file' THEN in_files ELSE allowed END, in_sessions, b.batch, sort)
    FROM plan, f, h, s, b WHERE kind = 'session' OR (kind = 'file' AND has_session)
    UNION ALL
    SELECT 5, 0, name, format('DELETE FROM lake.{0}; INSERT INTO lake.{0} FROM idx.{0}{1};',
      name, CASE WHEN has_host THEN ' WHERE ' || allowed ELSE '' END)
    FROM plan, h WHERE kind = 'whole' AND (SELECT count(*) > 0 FROM changed)
  )
SELECT sql FROM steps ORDER BY step, batch, name;
.read dml.sql

DELETE FROM lake.published_files WHERE (host, path) IN (SELECT (host, source_file) FROM changed);
INSERT INTO lake.published_files
SELECT f.* FROM idx.indexed_files f JOIN changed c ON c.host = f.host AND c.source_file = f.path
WHERE list_contains(getvariable('hosts'), f.host);

SET VARIABLE result = json_object(
  'files', (SELECT count(*) FROM changed),
  'sessions', (SELECT count(*) FROM touched),
  'rebuilt', getvariable('rebuild')
);
COMMIT;
SELECT getvariable('result');
