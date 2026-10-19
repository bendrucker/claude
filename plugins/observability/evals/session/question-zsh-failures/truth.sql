WITH errors(key) AS (
  VALUES ('no matches found'), ('bad substitution'), ('command not found: shopt'), ('bad pattern')
),
-- Filtering the JSON text before unnesting keeps this inside the reader's memory cap.
failed AS (
  SELECT DISTINCT host, (item->>'$.tool_use_id') AS id, (item->>'$.content') AS content
  FROM (
    SELECT host, unnest(json_extract(data, '$.message.content[*]')) AS item
    FROM raw
    WHERE type = 'user'
      AND regexp_matches(CAST(data AS VARCHAR), 'no matches found|bad substitution|command not found: shopt|bad pattern')
  )
  WHERE (item->>'$.type') = 'tool_result' AND (item->>'$.is_error') = 'true'
),
bash AS (
  SELECT DISTINCT host, (item->>'$.id') AS id
  FROM items
  WHERE (item->>'$.type') = 'tool_use' AND (item->>'$.name') = 'Bash'
    AND (item->>'$.id') IN (SELECT id FROM failed)
)
SELECT key, count(DISTINCT (failed.host, failed.id)) AS value
FROM failed JOIN bash USING (host, id) JOIN errors ON contains(failed.content, errors.key)
GROUP BY key;
