-- Sessions ranked by spend, one row per session. `sort` picks the axis: `cost` (default)
-- for the biggest estimated bills, `output` for the runaway or unattended-session
-- detector, where a huge output total spread over many messages is the signature of a
-- loop left running. Both axes are reported on every row either way, so a scan for one
-- shows the other beside it.
-- Reads the deduped per-message usage from message_usage. Summing raw rows inflates
-- totals 2-3.5x, because every content-block row repeats the parent message's usage.
-- Cost is an estimate from public per-MTok rates (model_input_rate/model_output_rate),
-- weighted per token class: cache reads 0.1x the input rate, cache writes 1.25x for the
-- 5m TTL and 2x for the 1h TTL. Against the 62 sessions carrying a real
-- cost-state.totalCostUSD it lands at 0.97 of billed spend ($1,582 vs $1,631).
-- Params: after_date, before_date, project, host, sort (cost|output), limit (default 15,
-- quoted as SET VARIABLE "limit" = 15 because limit is reserved).
WITH priced AS (
  SELECT
    mu.*,
    model_input_rate(mu.model)  AS in_rate,
    model_output_rate(mu.model) AS out_rate,
    COALESCE(mu.cache_1h_tokens, 0) AS w1h,
    COALESCE(mu.cache_5m_tokens,
             COALESCE(mu.cache_creation_tokens, 0) - COALESCE(mu.cache_1h_tokens, 0)) AS w5m
  FROM message_usage mu
  WHERE date_filter(mu.timestamp, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(mu.project_path, getvariable('project'))
    AND host_filter(mu.host, getvariable('host'))
)
SELECT
  session_id,
  ANY_VALUE(host)                                   AS host,
  regexp_extract(ANY_VALUE(project_path), '[^/]+$') AS repo,
  COUNT(*)                                          AS msgs,
  SUM(output_tokens)                                AS out_tokens,
  ROUND(AVG(output_tokens), 0)                      AS avg_out,
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
ORDER BY
  CASE WHEN COALESCE(getvariable('sort'), 'cost') = 'output'
       THEN out_tokens ELSE cost_usd_est END DESC NULLS LAST
LIMIT COALESCE(getvariable('limit'), 15);
