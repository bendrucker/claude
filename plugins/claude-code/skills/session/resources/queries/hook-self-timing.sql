-- ---
-- name: hook-self-timing
-- tier: 2
-- reads: disk
-- summary: >-
--   Hook latency from the hooks' own clocks, read off `~/.claude/hook-metrics/*.jsonl`
--   rather than the index.
-- description: >-
--   `hook_events` records a hook only when it produced visible output, a few percent of
--   actual fires, so every latency figure derived from it is conditioned on the hook having
--   said something. A self-timing hook appends one line per invocation, which makes `fires`
--   here the unbiased denominator behind `p50_ms`, `p95_ms`, and `p99_ms`.
--   `index_visible_pct` is the share of fires `hook_events` could have seen at all, the
--   bias factor on the `hooks` query for that hook.
--
--   The in-process duration excludes process spawn and interpreter start, which the harness
--   figure includes, so it runs below `hooks.p50_ms` by that fixed overhead. These files
--   are written on this machine only and carry no host column, so an imported host's
--   metrics are not part of the index. Only hooks that call the `user/scripts/hook-metrics`
--   helper appear, and with no file written yet DuckDB raises an IO Error naming the glob
--   rather than returning no rows.
-- params:
--   - name: metrics_glob
--     default: '~/.claude/hook-metrics/*.jsonl*'
--     meaning: rotated .1 files included
--   - name: hook
--     meaning: GLOB on hook name
--   - after_date
--   - before_date
-- ---
WITH runs AS (
  SELECT
    regexp_extract(filename, '([^/]+?)\.jsonl', 1) AS hook,
    session_id,
    hook_event,
    tool,
    duration_ms,
    outcome,
    TRY_CAST(ts AS TIMESTAMP) AS ts
  FROM read_json_auto(
    COALESCE(
      TRY_CAST(getvariable('metrics_glob') AS VARCHAR),
      '~/.claude/hook-metrics/*.jsonl*'
    ),
    union_by_name = true,
    filename = true
  )
),
scoped AS (
  SELECT *
  FROM runs
  WHERE date_filter(ts, getvariable('after_date'), getvariable('before_date'))
    AND (getvariable('hook') IS NULL OR hook GLOB TRY_CAST(getvariable('hook') AS VARCHAR))
)
SELECT
  hook,
  COUNT(*)                                              AS fires,
  COUNT(DISTINCT session_id)                            AS sessions,
  string_agg(DISTINCT hook_event, ', ')                 AS events,
  ROUND(AVG(duration_ms), 1)                            AS avg_ms,
  ROUND(quantile_cont(duration_ms, 0.5), 1)             AS p50_ms,
  ROUND(quantile_cont(duration_ms, 0.95), 1)            AS p95_ms,
  ROUND(quantile_cont(duration_ms, 0.99), 1)            AS p99_ms,
  ROUND(MAX(duration_ms), 1)                            AS max_ms,
  ROUND(SUM(duration_ms) / 1000.0, 1)                   AS total_s,
  COUNT(*) FILTER (outcome = 'silent')                  AS silent,
  COUNT(*) FILTER (outcome IN ('deny', 'ask', 'block')) AS blocking,
  COUNT(*) FILTER (outcome = 'context')                 AS context,
  COUNT(*) FILTER (outcome = 'error')                   AS errors,
  ROUND(100.0 * COUNT(*) FILTER (outcome <> 'silent') / COUNT(*), 1) AS index_visible_pct,
  MIN(ts)                                               AS first_seen,
  MAX(ts)                                               AS last_seen
FROM scoped
GROUP BY hook
ORDER BY total_s DESC NULLS LAST;
