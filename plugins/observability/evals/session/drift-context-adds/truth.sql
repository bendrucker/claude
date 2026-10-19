-- reference: hooks\.sql
SELECT (data->>'$.attachment.hookName') AS key, count(DISTINCT (data->>'$.uuid')) AS value
FROM raw
WHERE type = 'attachment' AND (data->>'$.attachment.type') = 'hook_additional_context'
GROUP BY key
ORDER BY value DESC
LIMIT 5;
