-- ---
-- name: fields
-- tier: 1
-- summary: >-
--   Schema discovery by inference: the JSON keys present at a path across records of a
--   kind, with each value's JSON type and an occurrence count.
-- description: >-
--   A key appearing with more than one type (type divergence) shows up as multiple rows.
--   This is the antidote to blindness: rather than relying on pre-extracted columns, ask
--   the corpus what fields exist for any record kind, then drill with `data->>'$.path'`.
-- params:
--   - name: kind
--     meaning: GLOB on the `records.kind` label, or null for all
--   - name: path
--     meaning: JSON path to enumerate, e.g. `$` or `$.attachment`
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH r AS (
  SELECT data
  FROM records
  WHERE (getvariable('kind') IS NULL OR kind GLOB getvariable('kind')::VARCHAR)
    AND date_filter(timestamp, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(project_path, getvariable('project'))
    AND host_filter(host, getvariable('host'))
    AND json_type(json_extract(data, getvariable('path')::VARCHAR)) = 'OBJECT'
)
SELECT
  field,
  json_type(json_extract(data, getvariable('path')::VARCHAR || '.' || field)) AS json_type,
  COUNT(*) AS n
FROM r, unnest(json_keys(data, getvariable('path')::VARCHAR)) AS t(field)
GROUP BY field, json_type
ORDER BY field, n DESC;
