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
