SELECT (item->'$.input'->>'skill') AS key, count(DISTINCT (host, item->>'$.id')) AS value
FROM items
WHERE timestamp >= '2026-10-01' AND timestamp < '2026-11-01'
  AND (item->>'$.type') = 'tool_use' AND (item->>'$.name') = 'Skill'
GROUP BY key
HAVING value >= 10;
