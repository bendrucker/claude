-- What a query would read from the lake's data files, from the catalog alone. The caller
-- sets VARIABLE scans to the plan's DuckLake scans as JSON: each one's table, projected
-- columns and filter text.
--
-- A file counts unless a comparison of a column with a constant rules it out by the
-- file's min and max. Row groups within a file, and filters a join adds at run time, are
-- not modeled, so the estimate is an upper bound on data bytes. The catalog fetch is not
-- included.
CREATE OR REPLACE TEMP MACRO excludes(op, lo, hi, v) AS CASE op
  WHEN '>=' THEN hi < v WHEN '>' THEN hi <= v
  WHEN '<=' THEN lo > v WHEN '<' THEN lo >= v
  ELSE v NOT BETWEEN lo AND hi
END;
-- A column compared with a quoted constant, cast or not, or with a number.
SET VARIABLE comparison = '(\w+) (>=|<=|>|<|=) (''(?:[^'']|'''')*''(?:::[A-Z ]+)?|-?\d+(?:\.\d+)?)';

WITH
  scans AS (
    SELECT unnest(from_json(getvariable('scans'), '[{"id": "INTEGER", "tbl": "VARCHAR", "projections": ["VARCHAR"], "filters": "VARCHAR"}]'), recursive := true)
  ),
  comparisons AS (
    SELECT s.id, unnest(regexp_extract_all(coalesce(s.filters, ''), getvariable('comparison'))) AS m
    FROM scans s
  ),
  preds AS (
    SELECT id, p.col, p.op, p.val
    FROM comparisons, LATERAL (SELECT regexp_extract(m, getvariable('comparison'), ['col', 'op', 'val']) AS p)
  ),
  tables AS (
    SELECT table_id, table_name FROM __ducklake_metadata_lake.ducklake_table WHERE end_snapshot IS NULL
  ),
  columns AS (
    SELECT table_id, column_id, column_name
    FROM __ducklake_metadata_lake.ducklake_column WHERE end_snapshot IS NULL
  ),
  stats AS (
    SELECT s.id, s.tbl, f.data_file_id, c.column_name, cs.column_size_bytes, cs.min_value, cs.max_value
    FROM scans s
    JOIN tables t ON t.table_name = s.tbl
    JOIN __ducklake_metadata_lake.ducklake_data_file f ON f.table_id = t.table_id AND f.end_snapshot IS NULL
    JOIN __ducklake_metadata_lake.ducklake_file_column_stats cs ON cs.data_file_id = f.data_file_id AND cs.table_id = f.table_id
    JOIN columns c ON c.table_id = cs.table_id AND c.column_id = cs.column_id
  ),
  -- Catalog stats print timestamps and dates in sortable ISO form, so every constant but a
  -- number compares as text.
  ruled_out AS (
    SELECT DISTINCT st.id, st.data_file_id
    FROM preds p
    JOIN stats st ON st.id = p.id AND st.column_name = p.col
    WHERE CASE WHEN p.val[1] = ''''
      THEN excludes(p.op, st.min_value, st.max_value,
        regexp_replace(regexp_replace(p.val, '::[A-Z ]+$', ''), '^''|''$', '', 'g'))
      ELSE excludes(p.op, TRY_CAST(st.min_value AS DOUBLE), TRY_CAST(st.max_value AS DOUBLE), TRY_CAST(p.val AS DOUBLE))
    END
  ),
  -- A filter's columns are read too, so any column the filter text names counts.
  needed AS (
    SELECT DISTINCT s.id, c.column_name
    FROM scans s
    JOIN tables t ON t.table_name = s.tbl
    JOIN columns c ON c.table_id = t.table_id
    WHERE list_contains(s.projections, c.column_name)
      OR regexp_matches(coalesce(s.filters, ''), '\b' || c.column_name || '\b')
  ),
  -- Each file read also fetches its footer, which a small window's reads are mostly made of.
  kept AS (
    SELECT st.id, st.tbl, st.data_file_id, sum(st.column_size_bytes) AS bytes
    FROM stats st
    JOIN needed n ON n.id = st.id AND n.column_name = st.column_name
    WHERE (st.id, st.data_file_id) NOT IN (SELECT (id, data_file_id) FROM ruled_out)
    GROUP BY ALL
  )
SELECT k.id, k.tbl, count(*) AS files, (sum(k.bytes) + sum(f.footer_size))::BIGINT AS bytes
FROM kept k
JOIN __ducklake_metadata_lake.ducklake_data_file f USING (data_file_id)
GROUP BY ALL
ORDER BY bytes DESC;
