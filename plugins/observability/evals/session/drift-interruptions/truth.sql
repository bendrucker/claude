-- An interruption is the harness's marker text, as a message of its own or a tool result's tail.
SELECT count(DISTINCT (data->>'$.uuid')) AS value
FROM items
WHERE timestamp >= '2026-09-01' AND timestamp < '2026-10-01'
  AND (data->>'$.type') = 'user'
  AND (starts_with(item->>'$.text', '[Request interrupted by user')
    OR (item->>'$.content') LIKE '%[Request interrupted by user%');
