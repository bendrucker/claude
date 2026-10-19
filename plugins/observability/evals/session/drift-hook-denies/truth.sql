-- reference: (hook-blocks|hooks)\.sql
SELECT tool AS key, count(*) AS value
FROM hook_denials
WHERE timestamp >= '2026-09-19' AND timestamp < '2026-10-19'
GROUP BY tool;
