-- Relations the truth queries share, read from `raw` alone so ground truth never runs through
-- the views under test. Temp views work on a read-only open.
CREATE TEMP VIEW items AS
SELECT host, session_id, timestamp, data, unnest(json_extract(data, '$.message.content[*]')) AS item
FROM raw
WHERE type IN ('user', 'assistant');

-- Tool calls a PreToolUse hook denied: the harness's permissionDecision where the record
-- carries one, else the error prefix that preceded the field. Replayed lines repeat an id.
CREATE TEMP VIEW hook_denials AS
WITH uses AS (
  SELECT DISTINCT host, (item->>'$.id') AS id, (item->>'$.name') AS tool
  FROM items WHERE (item->>'$.type') = 'tool_use'
),
denied AS (
  SELECT host, (item->>'$.tool_use_id') AS id, min(timestamp) AS timestamp
  FROM items
  WHERE (item->>'$.type') = 'tool_result'
    AND (item->>'$.is_error') = 'true'
    AND CASE
      WHEN json_extract(data, '$.permissionDecision.decision') IS NOT NULL
        THEN (data->>'$.permissionDecision.decision') = 'reject'
          AND (data->>'$.permissionDecision.source') = 'hook'
      ELSE regexp_matches(item->>'$.content', '^\s*(\[\{"type":"text","text":")?PreToolUse:\w+ hook error:')
    END
  GROUP BY ALL
)
SELECT host, id, tool, timestamp FROM denied JOIN uses USING (host, id);
