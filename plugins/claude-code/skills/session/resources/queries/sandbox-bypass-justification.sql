-- Per normalized command verb, how many `dangerouslyDisableSandbox` calls followed a
-- failed sandboxed run of the same command and how many carried no such failure. The
-- operating rule is to run sandboxed and bypass only after a sandboxed run of that
-- command actually failed, so `justified_pct` measures adherence per verb and, in the
-- `(all)` rollup row, across the whole corpus.
--
-- The verb comes from the same normalization `sandbox-bypass-effective-command` applies
-- (strip leading `cd <path>` wrappers, `echo` lines, and `VAR=value` env assignments,
-- optionally `export`ed) so the two queries agree on what counts as one command.
--
-- `justified` counts bypasses the view could back-link to a prior sandboxed failure of
-- the byte-identical command by the same agent in the same session. The absence of a
-- back-link is not evidence the sandbox would have worked: the model may have learned
-- the failure in an earlier session, in another repo, or from a command that differed
-- by a path. A low `justified_pct` on a verb is a prompt to check whether that verb
-- belongs in `excludedCommands` (so no bypass is needed) or whether the bypass is
-- reflex, not a prompt to conclude the bypass was unnecessary.
--
-- Rows are per (host, verb) plus one `(all)` rollup per host, which sorts first and
-- covers every verb including those under `min_count`.
-- Params: after_date, before_date, project, host, min_count (floor on a verb's total,
-- default 5).
WITH stripped AS (
  SELECT
    sb.host,
    sb.session_id,
    sb.retried_tool_id,
    regexp_replace(
      trim(sb.command),
      '^((cd [^&;\n]*|echo [^&;\n]*)(&&|;|\n)\s*|(export )?[A-Za-z_][A-Za-z0-9_]*=(\$\([^)]*\)|"[^"]*"|''[^'']*''|[^\s;&|]*)\s*(&&|;)?\s*)+',
      ''
    ) AS eff
  FROM sandbox_bypasses sb
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
),
verbs AS (
  SELECT
    host,
    session_id,
    retried_tool_id,
    regexp_extract(trim(eff), '^[A-Za-z0-9_./-]+', 0) AS cmd
  FROM stripped
  WHERE eff <> ''
),
grouped AS (
  SELECT
    host,
    CASE WHEN GROUPING(cmd) = 1 THEN '(all)' ELSE cmd END AS cmd,
    GROUPING(cmd) AS is_rollup,
    COUNT(*)                                                AS bypasses,
    COUNT(*) FILTER (WHERE retried_tool_id IS NOT NULL)     AS justified,
    COUNT(*) FILTER (WHERE retried_tool_id IS NULL)         AS reflexive,
    COUNT(DISTINCT session_id)                              AS sessions
  FROM verbs
  GROUP BY GROUPING SETS ((host), (host, cmd))
)
SELECT
  host,
  cmd,
  bypasses,
  justified,
  reflexive,
  ROUND(100.0 * justified / bypasses, 1) AS justified_pct,
  sessions
FROM grouped
WHERE is_rollup = 1 OR bypasses >= COALESCE(getvariable('min_count'), 5)
ORDER BY host, is_rollup DESC, bypasses DESC, cmd;
