-- ---
-- name: tool-failure-rates
-- tier: 2
-- dimensions: [tool-failures]
-- summary: >-
--   Per-tool failure rates over calls that ran, with the failures grouped by normalized
--   signature and dated so a fixed failure reads as stopped.
-- description: >-
--   `calls`, `failures`, and `failure_pct` are per tool and repeat on each of its signature
--   rows. Denied calls never ran, so they leave both the numerator and the denominator, and
--   `permissions` reports them. The signature strips the `<tool_use_error>` wrapper,
--   absolute paths, lowercase tokens mixing letters and digits (task, agent, and commit
--   ids), and digit runs, so one failure across many targets collapses to one row.
--
--   `agent_threads` counts distinct (session, agent) contexts, since a subagent stamps its
--   rows with the parent's session id and `sessions` alone credits a whole fan-out to one
--   transcript. `first_seen` and `last_seen` bound each signature: one whose `last_seen`
--   predates a fix describes a closed bug.
-- params:
--   - name: min_calls
--     default: 30
--     meaning: floor on a tool's call count, so a rarely called tool cannot top the ranking
--   - name: limit
--     default: 5
--     meaning: signatures per tool
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH calls AS (
  SELECT tc.host, tc.session_id, tc.tool_name, te.agent_id, te.error_content, te.timestamp,
         te.tool_id IS NOT NULL AS failed
  FROM tool_calls tc
  JOIN sessions s USING (host, session_id)
  LEFT JOIN tool_errors te ON te.host = tc.host AND te.tool_id = tc.tool_id
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
    AND te.denial_kind IS NULL
),
per_tool AS (
  SELECT host, tool_name, COUNT(*) AS calls, COUNT(*) FILTER (WHERE failed) AS failures
  FROM calls
  GROUP BY host, tool_name
  HAVING COUNT(*) >= COALESCE(TRY_CAST(getvariable('min_calls') AS INTEGER), 30) AND COUNT(*) FILTER (WHERE failed) > 0
),
signed AS (
  SELECT *,
    substr(trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      error_content,
      '</?tool_use_error>', '', 'g'),
      '(~|/(Users|home|private|tmp|var|opt|Volumes))/[^\s"''`:,;()]*', '<path>', 'g'),
      '\b[a-z0-9]*([0-9][a-z0-9]*[a-z]|[a-z][a-z0-9]*[0-9])[a-z0-9]*\b', '<id>', 'g'),
      '\d+', 'N', 'g'),
      '\s+', ' ', 'g')), 1, 100) AS signature
  FROM calls
  WHERE failed
),
per_signature AS (
  SELECT host, tool_name, signature,
    COUNT(*)                                        AS errors,
    COUNT(DISTINCT session_id)                      AS sessions,
    COUNT(DISTINCT (session_id, agent_id))          AS agent_threads,
    MIN(timestamp)                                  AS first_seen,
    MAX(timestamp)                                  AS last_seen
  FROM signed
  GROUP BY host, tool_name, signature
)
SELECT
  pt.host,
  pt.tool_name,
  pt.calls,
  pt.failures,
  ROUND(100.0 * pt.failures / pt.calls, 1) AS failure_pct,
  ps.signature,
  ps.errors,
  ps.sessions,
  ps.agent_threads,
  ps.first_seen,
  ps.last_seen
FROM per_tool pt
JOIN per_signature ps USING (host, tool_name)
QUALIFY ROW_NUMBER() OVER (PARTITION BY pt.host, pt.tool_name ORDER BY ps.errors DESC, ps.signature) <= COALESCE(TRY_CAST(getvariable('limit') AS INTEGER), 5)
ORDER BY failure_pct DESC, pt.host, pt.tool_name, ps.errors DESC, ps.signature;
