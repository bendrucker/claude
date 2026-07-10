-- Temporal view of one session's token burn: per-bucket message counts, token classes,
-- estimated cost, a context-size proxy, and cache-miss ratio. Reads the deduped
-- per-message usage from message_usage (raw rows repeat the parent message's usage, so
-- summing them inflates totals 2-3.5x).
-- Cost is an estimate from public per-MTok rates (model_input_rate/model_output_rate),
-- useful as a relative weight rather than a billed figure: cache reads bill 0.1x the
-- input rate, cache writes 1.25x for the 5m TTL and 2x for the 1h TTL.
-- Params: session (required), host, bucket_minutes (default 10).
WITH priced AS (
  SELECT
    mu.*,
    model_input_rate(mu.model)  AS in_rate,
    model_output_rate(mu.model) AS out_rate,
    COALESCE(mu.cache_1h_tokens, 0) AS w1h,
    COALESCE(mu.cache_5m_tokens,
             COALESCE(mu.cache_creation_tokens, 0) - COALESCE(mu.cache_1h_tokens, 0)) AS w5m
  FROM message_usage mu
  WHERE mu.session_id = getvariable('session')
    AND host_filter(mu.host, getvariable('host'))
)
SELECT
  time_bucket(INTERVAL (COALESCE(getvariable('bucket_minutes'), 10) || ' minutes'), timestamp) AS bucket,
  COUNT(*)                                        AS msgs,
  ROUND(SUM(
    (COALESCE(input_tokens, 0) * in_rate
     + w5m * 1.25 * in_rate
     + w1h * 2.0  * in_rate
     + COALESCE(cache_read_tokens, 0) * 0.1 * in_rate
     + COALESCE(output_tokens, 0) * out_rate) / 1e6
  ), 2)                                           AS cost_usd_est,
  SUM(COALESCE(input_tokens, 0))                  AS input_tokens,
  SUM(COALESCE(output_tokens, 0))                 AS output_tokens,
  SUM(COALESCE(cache_creation_tokens, 0))         AS cache_write_tokens,
  SUM(COALESCE(cache_read_tokens, 0))             AS cache_read_tokens,
  ROUND(SUM(COALESCE(cache_creation_tokens, 0))
        / GREATEST(SUM(COALESCE(cache_creation_tokens, 0)) + SUM(COALESCE(cache_read_tokens, 0)), 1), 2)
                                                  AS cache_miss_ratio,
  MAX(COALESCE(input_tokens, 0) + COALESCE(cache_read_tokens, 0) + COALESCE(cache_creation_tokens, 0))
                                                  AS max_context_tokens,
  ROUND(AVG(CASE WHEN is_sidechain THEN 1 ELSE 0 END), 2) AS sidechain_share,
  MODE(model)                                     AS top_model,
  MODE(attribution_agent)                         AS top_agent,
  MODE(attribution_skill)                         AS top_skill
FROM priced
GROUP BY bucket
ORDER BY bucket;
