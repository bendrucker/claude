-- A mention in a message or a Bash command; a file the session read does not count.
SELECT DISTINCT session_id AS key
FROM (
  SELECT session_id, unnest(json_extract(data, '$.message.content[*]')) AS item
  FROM raw
  WHERE type IN ('user', 'assistant') AND contains(CAST(data AS VARCHAR), 'pytest-benchmark')
)
WHERE session_id IS NOT NULL
  AND ((item->>'$.type') = 'text' AND contains(item->>'$.text', 'pytest-benchmark')
    OR (item->>'$.type') = 'tool_use' AND (item->>'$.name') = 'Bash'
      AND contains(item->>'$.input.command', 'pytest-benchmark'));
