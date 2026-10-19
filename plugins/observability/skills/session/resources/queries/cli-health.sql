-- ---
-- name: cli-health
-- tier: 2
-- dimensions: [tool-failures]
-- summary: >-
--   Bash calls grouped by the program they run, with error rates that count SQL errors a
--   zero exit hid, latency, retries, and the top error signatures.
-- description: >-
--   One row per (`host`, `program`), the first command's basename after leading `cd` hops
--   and `VAR=value` assignments. `hidden_error_pct` counts exit-0 results that open with a
--   DuckDB error, which `tool-failure-rates` misses. Read `retry_pct` against
--   `followup_pct`, the same two-minute rate after a success. Gaps include approval time.
--   `top_errors` is the first output line past `Exit code N`, digits and paths stripped.
-- params:
--   - name: min_calls
--     default: 30
--     meaning: floor on a program's call count
--   - name: limit
--     default: 5
--     meaning: signatures per program
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH calls AS (
  SELECT
    tc.host, tc.session_id, tc.agent_id, tc.timestamp,
    regexp_replace(
      regexp_extract(
        regexp_replace(
          tc.command,
          '^(\s*(cd\s+("[^"]*"|''[^'']*''|\S+)(\s*\d?>\S+)*\s*(&&|\|\||;|\n)|[A-Za-z_][A-Za-z0-9_]*=(''[^'']*''|"[^"]*"|\S*)\s*;?))+\s*', ''),
        '^\S+'),
      '^.*/', '') AS program,
    COALESCE(tr.is_error, FALSE) AS failed,
    NOT COALESCE(tr.is_error, FALSE)
      AND regexp_matches(tr.content, '^\s*(Binder|Parser|Catalog|Conversion|IO) Error:') AS hidden,
    date_diff('millisecond', tc.timestamp, tr.timestamp) / 1000.0 AS gap_s,
    tr.content
  FROM tool_calls tc
  JOIN scoped_sessions() s USING (host, session_id)
  LEFT JOIN content_items tr
    ON tr.tool_use_id = tc.tool_id AND tr.host = tc.host AND tr.type = 'tool_result'
  WHERE tc.tool_name = 'Bash'
    AND tc.command IS NOT NULL
),
sequenced AS (
  SELECT *,
    failed OR COALESCE(hidden, FALSE) AS errored,
    LEAD(timestamp) OVER (
      PARTITION BY host, session_id, agent_id, program ORDER BY timestamp
    ) AS next_ts
  FROM calls
  WHERE program != ''
),
signatures AS (
  SELECT host, program,
    substr(trim(regexp_replace(regexp_replace(regexp_replace(
      regexp_extract(content, '^\s*(Exit code \d+\s*\n)?\s*([^\n]*)', 2),
      '(~|/(Users|home|private|tmp|var|opt|Volumes))/[^\s"''`:,;()]*', '<path>', 'g'),
      '\d+', 'N', 'g'),
      '\s+', ' ', 'g')), 1, 100) AS signature,
    COUNT(*) AS n
  FROM sequenced
  WHERE errored
  GROUP BY ALL
),
top_signatures AS (
  SELECT host, program,
    list(signature || ' (' || n || ')' ORDER BY n DESC, signature) AS top_errors
  FROM (
    SELECT * FROM signatures
    QUALIFY ROW_NUMBER() OVER (PARTITION BY host, program ORDER BY n DESC, signature)
      <= COALESCE(TRY_CAST(getvariable('limit') AS INTEGER), 5)
  )
  GROUP BY host, program
)
SELECT
  host,
  program,
  COUNT(*) AS calls,
  COUNT(DISTINCT session_id) AS sessions,
  ROUND(100.0 * COUNT(*) FILTER (WHERE failed) / COUNT(*), 1) AS error_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE hidden) / COUNT(*), 1) AS hidden_error_pct,
  ROUND(quantile_cont(gap_s, 0.5), 1) AS p50_gap_s,
  ROUND(quantile_cont(gap_s, 0.9), 1) AS p90_gap_s,
  ROUND(100.0 * COUNT(*) FILTER (WHERE errored AND next_ts <= timestamp + INTERVAL 2 MINUTE)
    / NULLIF(COUNT(*) FILTER (WHERE errored), 0), 1) AS retry_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE NOT errored AND next_ts <= timestamp + INTERVAL 2 MINUTE)
    / NULLIF(COUNT(*) FILTER (WHERE NOT errored), 0), 1) AS followup_pct,
  ANY_VALUE(t.top_errors) AS top_errors
FROM sequenced
LEFT JOIN top_signatures t USING (host, program)
GROUP BY host, program
HAVING COUNT(*) >= COALESCE(TRY_CAST(getvariable('min_calls') AS INTEGER), 30)
ORDER BY calls DESC, host, program;
