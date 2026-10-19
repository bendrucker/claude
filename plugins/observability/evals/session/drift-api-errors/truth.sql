SELECT
  coalesce((data->>'$.error.status'), (data->>'$.error.connection.code'), 'unknown') AS key,
  count(DISTINCT (data->>'$.uuid')) AS value
FROM raw
WHERE type = 'system' AND (data->>'$.subtype') = 'api_error'
GROUP BY key;
