-- ---
-- name: usage-spikes
-- tier: 1
-- summary: >-
--   Ranked (session, time bucket) burn windows across the corpus, the same shape columns as
--   `usage-timeline` plus `host`, `session_id`, and `repo` (the last path component).
-- description: >-
--   Cost-weighted spend is what separates an expected burst such as a workflow fan-out from
--   a defect such as a hook loop, a cache-miss storm, or the repeat-read tax. Reads the
--   deduped per-message usage from `message_usage`, since raw rows repeat the parent
--   message's usage.
--
--   Cost is an estimate from public per-MTok API rates (`model_input_rate` and
--   `model_output_rate`), weighted per token class: cache reads at 0.1x the input rate,
--   cache writes at 1.25x for the 5m TTL and 2x for the 1h TTL. Against the 62 sessions
--   carrying a real `cost-state.totalCostUSD` it lands at 0.97 of billed spend, so read it
--   as a close approximation rather than an exact bill. `scripts/usage.ts` renders the same
--   numbers in the terminal.
-- params:
--   - name: bucket_minutes
--     default: 10
--   - name: limit
--     default: 30
--     meaning: reserved word, so quote the name as SET VARIABLE with double quotes
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
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
),
costed AS (
  SELECT
    *,
    (COALESCE(input_tokens, 0) * in_rate
     + w5m * 1.25 * in_rate
     + w1h * 2.0  * in_rate
     + COALESCE(cache_read_tokens, 0) * 0.1 * in_rate
     + COALESCE(output_tokens, 0) * out_rate) / 1e6 AS cost_usd
  FROM priced
)
SELECT
  time_bucket(INTERVAL (COALESCE(getvariable('bucket_minutes'), 10) || ' minutes'), timestamp) AS bucket,
  host,
  session_id,
  regexp_extract(ANY_VALUE(project_path), '[^/]+$') AS repo,
  COUNT(*)                                          AS msgs,
  ROUND(SUM(cost_usd), 2)                           AS cost_usd_est,
  SUM(COALESCE(input_tokens, 0))                    AS input_tokens,
  SUM(COALESCE(output_tokens, 0))                   AS output_tokens,
  SUM(COALESCE(cache_creation_tokens, 0))           AS cache_write_tokens,
  SUM(COALESCE(cache_read_tokens, 0))               AS cache_read_tokens,
  ROUND(SUM(COALESCE(cache_creation_tokens, 0))
        / GREATEST(SUM(COALESCE(cache_creation_tokens, 0)) + SUM(COALESCE(cache_read_tokens, 0)), 1), 2)
                                                    AS cache_miss_ratio,
  MAX(COALESCE(input_tokens, 0) + COALESCE(cache_read_tokens, 0) + COALESCE(cache_creation_tokens, 0))
                                                    AS max_context_tokens,
  ROUND(AVG(CASE WHEN is_sidechain THEN 1 ELSE 0 END), 2) AS sidechain_share,
  MODE(model)                                       AS top_model,
  MODE(attribution_agent)                           AS top_agent,
  MODE(attribution_skill)                           AS top_skill
FROM costed
GROUP BY bucket, host, session_id
ORDER BY cost_usd_est DESC NULLS LAST
LIMIT COALESCE(getvariable('limit'), 30);
