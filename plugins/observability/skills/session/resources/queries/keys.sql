-- ---
-- name: keys
-- tier: 1
-- summary: >-
--   Which top-level JSON keys appear in `raw.data`, the unstructured part, with occurrence
--   counts.
-- description: >-
--   Samples 500 chat rows rather than scanning the corpus, so it answers what a record
--   carries before you reach in with `data->>'$.path'`, not how often a key occurs overall.
-- ---
WITH sampled AS (
  SELECT data
  FROM raw
  WHERE type IN ('user', 'assistant')
  USING SAMPLE 500 ROWS
)
SELECT
  key,
  COUNT(*) AS occurrences
FROM sampled, LATERAL (SELECT unnest(json_keys(data)) AS key) k
GROUP BY key
ORDER BY occurrences DESC, key;
