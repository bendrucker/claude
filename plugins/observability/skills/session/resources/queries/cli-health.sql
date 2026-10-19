-- ---
-- name: cli-health
-- tier: 2
-- dimensions: [tool-failures]
-- summary: >-
--   Bash calls grouped by the program they run, with error rates that count SQL errors a
--   zero exit hid, latency, retries, and the top error signatures.
-- description: >-
--   One row per (`host`, `program`). `program` is the first command's basename after
--   leading `cd <dir> &&` hops and `VAR=value` assignments are stripped, so `cd x && D=y;
--   duckdb ...` reads as `duckdb`. That extraction is a heuristic: a command opening with a
--   subshell, a loop, or a quoted path lands under whatever token comes first.
--
--   `error_pct` is the share of calls whose result carried `is_error`, a non-zero exit.
--   `hidden_error_pct` is the share that exited 0 but printed a DuckDB `Binder`, `Parser`,
--   `Catalog`, `Conversion`, or `IO` error, which `tool-failure-rates` cannot see because
--   it reads `is_error` alone. A pipe into `head` or `tail` is the usual cause.
--   `retry_pct` is the share of failed calls (either kind) followed by another call to the
--   same program in the same agent thread within two minutes.
--
--   `p50_gap_s` and `p90_gap_s` are the gap from the call to its result. They include
--   permission prompts and approval time, so they bound latency from above.
--   `top_errors` lists the commonest normalized signatures with counts, digits and paths
--   stripped and quoted identifiers kept, so a guessed column or a reserved-word alias
--   reads straight off the signature.
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
          '^(\s*(cd\s+\S+\s*(&&|;)|[A-Za-z_][A-Za-z0-9_]*=(''[^'']*''|"[^"]*"|\S*)\s*;?))+\s*', ''),
        '^\S+'),
      '^.*/', '') AS program,
    COALESCE(tr.is_error, FALSE) AS failed,
    NOT COALESCE(tr.is_error, FALSE)
      AND regexp_matches(tr.content, '(Binder|Parser|Catalog|Conversion|IO) Error') AS hidden,
    date_diff('millisecond', tc.timestamp, tr.timestamp) / 1000.0 AS gap_s,
    tr.content
  FROM tool_calls tc
  JOIN sessions s USING (host, session_id)
  LEFT JOIN content_items tr
    ON tr.tool_use_id = tc.tool_id AND tr.host = tc.host AND tr.type = 'tool_result'
  WHERE tc.tool_name = 'Bash'
    AND tc.command IS NOT NULL
    AND date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
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
      COALESCE(
        NULLIF(regexp_extract(content, '\w+ Error: [^\n]*'), ''),
        split_part(trim(content), chr(10), 1)),
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
  ANY_VALUE(t.top_errors) AS top_errors
FROM sequenced
LEFT JOIN top_signatures t USING (host, program)
GROUP BY host, program
HAVING COUNT(*) >= COALESCE(TRY_CAST(getvariable('min_calls') AS INTEGER), 30)
ORDER BY calls DESC, host, program;
