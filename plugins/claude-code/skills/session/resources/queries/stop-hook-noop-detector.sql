-- Stop hooks that never produce stdout, a decision, a block, or a non-zero exit:
-- pure-overhead automations that fire on every Stop and do nothing observable
-- (removal candidates). A hook all-zero across with_stdout/with_decision/
-- nonzero_exit/blocks earns its latency back by being deleted. Blocking errors
-- (exit-2 gates) arrive as kind=hook_blocking_error with no command, stdout,
-- decision, or exit code, so they group under the bare hook event name ('Stop');
-- the `blocks` column keeps a gate that blocks from reading as pure overhead.
-- Params: after_date, before_date, project, host.
WITH ev AS (
  SELECT
    he.host,
    COALESCE(he.command, he.hook_name) AS command,
    he.kind,
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
  COUNT(*) FILTER (WHERE exit_code <> 0)                      AS nonzero_exit,
  COUNT(*) FILTER (WHERE kind = 'hook_blocking_error')        AS blocks
FROM ev
GROUP BY host, command
ORDER BY fires DESC, host;
