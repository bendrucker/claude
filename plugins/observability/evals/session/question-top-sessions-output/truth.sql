-- tolerance: 0.02
-- One count per message, as in question-output-tokens-by-model, over main-thread records only.
SELECT session_id AS key, sum(output)::BIGINT AS value
FROM (
  SELECT any_value(session_id) AS session_id,
    max(CAST(data->>'$.message.usage.output_tokens' AS BIGINT)) AS output
  FROM raw
  WHERE type = 'assistant' AND timestamp >= '2026-09-01' AND timestamp < '2026-10-01'
    AND (data->>'$.message.id') IS NOT NULL AND NOT coalesce((data->>'$.isSidechain')::BOOLEAN, false)
  GROUP BY host, (data->>'$.message.id')
)
GROUP BY session_id
ORDER BY value DESC
LIMIT 3;
