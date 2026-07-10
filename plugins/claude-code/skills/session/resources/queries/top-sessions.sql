-- Top sessions by estimated cost within a lookback window. Reads the deduped per-message
-- usage from message_usage (raw rows repeat the parent message's usage, so summing them
-- inflates totals 2-3.5x).
-- Cost is an estimate from public per-MTok rates (model_input_rate/model_output_rate),
-- useful as a relative weight rather than a billed figure: cache reads bill 0.1x the
-- input rate, cache writes 1.25x for the 5m TTL and 2x for the 1h TTL.
-- Params: after_date (required), host.
WITH priced AS (
  SELECT
    mu.*,
    model_input_rate(mu.model)  AS in_rate,
    model_output_rate(mu.model) AS out_rate,
    COALESCE(mu.cache_1h_tokens, 0) AS w1h,
    COALESCE(mu.cache_5m_tokens,
             COALESCE(mu.cache_creation_tokens, 0) - COALESCE(mu.cache_1h_tokens, 0)) AS w5m
  FROM message_usage mu
  WHERE date_filter(mu.timestamp, getvariable('after_date'), NULL)
    AND host_filter(mu.host, getvariable('host'))
)
SELECT
  session_id,
  ANY_VALUE(host)                                   AS host,
  regexp_extract(ANY_VALUE(project_path), '[^/]+$') AS repo,
  COUNT(*)                                          AS msgs,
  ROUND(SUM(
    (COALESCE(input_tokens, 0) * in_rate
     + w5m * 1.25 * in_rate
     + w1h * 2.0  * in_rate
     + COALESCE(cache_read_tokens, 0) * 0.1 * in_rate
     + COALESCE(output_tokens, 0) * out_rate) / 1e6
  ), 2)                                             AS cost_usd_est,
  strftime(MAX(timestamp), '%Y-%m-%d %H:%M:%S')     AS last_activity
FROM priced
GROUP BY session_id
ORDER BY cost_usd_est DESC NULLS LAST
LIMIT 10;
