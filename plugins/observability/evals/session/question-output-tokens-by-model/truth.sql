-- tolerance: 0.02
-- Streaming writes one record per content block, each repeating the message's usage, so a
-- message counts once, at its largest output_tokens. <synthetic> records carry no real usage.
SELECT model AS key, sum(output)::BIGINT AS value
FROM (
  SELECT any_value(data->>'$.message.model') AS model,
    max(CAST(data->>'$.message.usage.output_tokens' AS BIGINT)) AS output
  FROM raw
  WHERE type = 'assistant' AND timestamp >= '2026-09-01' AND timestamp < '2026-10-01'
    AND (data->>'$.message.id') IS NOT NULL
  GROUP BY host, (data->>'$.message.id')
)
WHERE model <> '<synthetic>'
GROUP BY model;
