SELECT count(DISTINCT (host, (item->>'$.id'))) AS value
FROM items
WHERE (item->>'$.type') = 'tool_use' AND (item->>'$.name') = 'AskUserQuestion'
  AND timestamp >= '2026-08-01' AND timestamp < '2026-10-01';
