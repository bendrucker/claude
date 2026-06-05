-- Stop hooks that never produce stdout, a decision, or a non-zero exit: pure-overhead
-- automations that fire on every Stop and do nothing observable (removal candidates).
-- Compare with_stdout/with_decision/nonzero_exit against fires: a hook all-zero across
-- those three columns earns its latency back by being deleted.
-- Params: after_date, before_date, project, host.
WITH ev AS (
  SELECT
    he.host,
    COALESCE(he.command, he.hook_name) AS command,
    he.stdout,
    he.decision,
    he.exit_code
  FROM hook_events he
  JOIN sessions s USING (host, session_id)
  WHERE he.hook_event = 'Stop'
    AND date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
)
SELECT
  host,
  command,
  COUNT(*)                                                    AS fires,
  COUNT(*) FILTER (WHERE stdout IS NOT NULL AND length(stdout) > 0) AS with_stdout,
  COUNT(*) FILTER (WHERE decision IS NOT NULL)                AS with_decision,
  COUNT(*) FILTER (WHERE exit_code <> 0)                      AS nonzero_exit
FROM ev
GROUP BY host, command
ORDER BY fires DESC, host;
