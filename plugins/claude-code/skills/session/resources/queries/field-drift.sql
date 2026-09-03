-- ---
-- name: field-drift
-- tier: 1
-- summary: >-
--   Fields the harness started writing recently, on record kinds the corpus already
--   carried.
-- description: >-
--   `index-health`'s `stream-new` check keys on record kind, so it fires only when a whole
--   kind appears and has never fired on a new field. Every field that mattered most
--   recently (`$.effort`, `thinking_tokens`, `promptSource`, `toolDenialKind`,
--   `cache_miss_reason`) arrived on a kind the corpus had carried for months, exactly the
--   case that check cannot see. This walks `raw.data` itself, objects and arrays alike, and
--   reports every `kind:$.path` with zero occurrences before the cutoff, ordered by recent
--   volume.
--
--   Array elements share their parent's path, so `content[0].type` and `content[7].type`
--   are one field. Sampling is deterministic on the row's identity rather than random, so a
--   rerun walks the same rows and a field appearing or disappearing between runs is a real
--   change. Map-shaped kinds whose keys are file paths and UUIDs (`file-history-snapshot`,
--   `file-history-delta`, `artifact-autoreact-ledger`) are excluded, since every row invents
--   fresh paths. Rows are dated by their file's earliest timestamp, because 20 kinds carry
--   no `timestamp` of their own and would otherwise fall out of both sides of the cutoff.
--
--   Run it periodically rather than per analysis pass: tens of seconds against
--   `index-health`'s six.
-- params:
--   - name: new_days
--     default: 45
--   - name: cutoff_date
--     meaning: an explicit boundary overriding `new_days`, for auditing a past window
--   - name: min_rows
--     default: 50
--     meaning: floor on recent occurrences
--   - name: sample_pct
--     default: 40
--     meaning: the share of rows walked
--   - host
-- ---
-- The walk descends through objects and arrays alike, so it never builds a JSON path
-- string out of a key. Keys in this corpus contain quotes, which an interpolated
-- `'$."' || key || '"'` would break on. `list_zip(json_keys(v), json_extract(v, '$.*'))`
-- pairs each key with its value without one. Objects and arrays share a single recursive
-- term, because two UNION ALL terms over the same CTE raise a circular-reference binder
-- error.
WITH RECURSIVE file_start AS (
  SELECT source_file, MIN(timestamp) AS first_ts
  FROM raw
  WHERE timestamp IS NOT NULL
  GROUP BY source_file
),
sampled AS (
  SELECT r.type, r.data, COALESCE(r.timestamp, f.first_ts) AS effective_ts
  FROM raw r
  LEFT JOIN file_start f ON f.source_file = r.source_file
  -- Map-shaped kinds whose keys are file paths and UUIDs. Every row invents fresh paths,
  -- which floods the result with one-off noise and dominates the walk's cost.
  WHERE r.type NOT IN ('file-history-snapshot', 'file-history-delta', 'artifact-autoreact-ledger')
    AND host_filter(r.host, getvariable('host'))
    AND r.data IS NOT NULL
    -- Hashing the row's identity samples deterministically, so a rerun walks the same
    -- rows and a field appearing or disappearing between runs is a real change rather
    -- than the sample moving. `USING SAMPLE` takes only a literal percentage.
    AND hash(r.source_file || ':' || r.source_line) % 100
        < COALESCE(TRY_CAST(getvariable('sample_pct') AS BIGINT), 40)
),
walk AS (
  SELECT
    s.type,
    s.effective_ts,
    1 AS depth,
    kv.k AS field_path,
    kv.v AS node
  FROM sampled s,
  LATERAL (
    SELECT unnest(list_transform(
      list_zip(json_keys(s.data), json_extract(s.data, '$.*')),
      lambda p: {'k': struct_extract(p, 1), 'v': struct_extract(p, 2)}
    )) AS kv
  ) z
  WHERE json_type(s.data) = 'OBJECT'

  UNION ALL

  SELECT
    w.type,
    w.effective_ts,
    -- Depth counts path segments, not JSON nesting. An array element adds no segment,
    -- so descending into one must not spend a level: otherwise a three-segment field
    -- reached through an array (`message.content[].type`) falls outside the limit.
    w.depth + CASE WHEN kv.k IS NULL THEN 0 ELSE 1 END,
    CASE WHEN kv.k IS NULL THEN w.field_path ELSE w.field_path || '.' || kv.k END,
    kv.v
  FROM walk w,
  LATERAL (
    SELECT unnest(
      CASE json_type(w.node)
        -- An array element inherits its parent's path, so `content[0].type` and
        -- `content[7].type` are one field rather than an index per position.
        WHEN 'ARRAY' THEN list_transform(
          json_extract(w.node, '$[*]'),
          lambda x: {'k': NULL::VARCHAR, 'v': x}
        )
        ELSE list_transform(
          list_zip(json_keys(w.node), json_extract(w.node, '$.*')),
          lambda p: {'k': struct_extract(p, 1), 'v': struct_extract(p, 2)}
        )
      END
    ) AS kv
  ) z
  WHERE w.depth < 3
    AND json_type(w.node) IN ('OBJECT', 'ARRAY')
),
cutoff AS (
  SELECT COALESCE(
    TRY_CAST(getvariable('cutoff_date') AS TIMESTAMP),
    current_date - COALESCE(TRY_CAST(getvariable('new_days') AS INTEGER), 45) * INTERVAL 1 DAY
  ) AS ts
),
paths AS (
  SELECT
    w.type,
    w.field_path,
    COUNT(*) FILTER (WHERE w.effective_ts <  c.ts) AS before_rows,
    COUNT(*) FILTER (WHERE w.effective_ts >= c.ts) AS recent_rows,
    MIN(w.effective_ts)                            AS first_seen,
    MAX(w.effective_ts)                            AS last_seen
  FROM walk w, cutoff c
  WHERE w.effective_ts IS NOT NULL
  GROUP BY w.type, w.field_path
)
SELECT
  type || ':$.' || field_path AS field,
  recent_rows,
  strftime(first_seen, '%Y-%m-%d') AS first_seen,
  strftime(last_seen, '%Y-%m-%d')  AS last_seen
FROM paths
WHERE before_rows = 0
  AND recent_rows >= COALESCE(TRY_CAST(getvariable('min_rows') AS BIGINT), 50)
ORDER BY recent_rows DESC, field;
