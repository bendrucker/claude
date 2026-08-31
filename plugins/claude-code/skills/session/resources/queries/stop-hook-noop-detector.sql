-- Stop hooks that never produce stdout, a decision, a block, or a non-zero exit:
-- pure-overhead automations that fire on every Stop and do nothing observable
-- (removal candidates). `total_ms` is the latency deleting one would buy back.
--
-- `fires` comes from the `hookInfos` roster in each stop_hook_summary, which lists every
-- hook the harness ran. `events` counts the attachment records the same hook wrote. A
-- hook that produces no output writes no attachment, so a row with many fires and zero
-- events is the strongest removal candidate and is exactly what the attachment channel
-- alone cannot see. The join is full outer because the roster starts 2026-04-27, so an
-- older attachment row has no fire to match.
--
-- Blocking errors (exit-2 gates) arrive as kind=hook_blocking_error with no command,
-- stdout, decision, or exit code, and nothing in the record identifies which hook exited
-- 2, so they group under the bare hook event name ('Stop') in the `blocks` column.
-- `gated_stops` covers the gap from the roster side: the Stop's `toolUseID` is shared by
-- its summary and its blocking error, so a hook's fires at a gated Stop are countable
-- even though the gate itself is not attributable. Zero events and zero gated stops is a
-- hook that never ran at a blocked Stop; gated stops mean it may be the gate.
--
-- Roster entries carrying `prompt_text` are queued prompts the harness re-injected at
-- Stop, not configured hooks, and are excluded.
-- Params: after_date, before_date, project, host.
WITH gated AS (
  SELECT DISTINCT host, tool_use_id
  FROM hook_events
  WHERE hook_event = 'Stop'
    AND kind = 'hook_blocking_error'
    AND tool_use_id IS NOT NULL
),
runs AS (
  SELECT
    r.host,
    r.command,
    COUNT(*)                                            AS fires,
    SUM(r.duration_ms)                                  AS total_ms,
    COUNT(*) FILTER (WHERE g.tool_use_id IS NOT NULL)   AS gated_stops
  FROM stop_hook_runs r
  JOIN sessions s USING (host, session_id)
  LEFT JOIN gated g ON g.host = r.host AND g.tool_use_id = r.tool_use_id
  WHERE r.prompt_text IS NULL
    AND date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
  GROUP BY r.host, r.command
),
observed AS (
  SELECT
    he.host,
    COALESCE(he.command, he.hook_name) AS command,
    COUNT(*)                                                          AS events,
    COUNT(*) FILTER (WHERE he.stdout IS NOT NULL AND length(he.stdout) > 0) AS with_stdout,
    COUNT(*) FILTER (WHERE he.decision IS NOT NULL)                   AS with_decision,
    COUNT(*) FILTER (WHERE he.exit_code <> 0)                         AS nonzero_exit,
    COUNT(*) FILTER (WHERE he.kind = 'hook_blocking_error')           AS blocks
  FROM hook_events he
  JOIN sessions s USING (host, session_id)
  WHERE he.hook_event = 'Stop'
    AND date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
  GROUP BY 1, 2
)
SELECT
  COALESCE(r.host, o.host)       AS host,
  COALESCE(r.command, o.command) AS command,
  COALESCE(r.fires, 0)           AS fires,
  COALESCE(r.total_ms, 0)        AS total_ms,
  COALESCE(o.events, 0)          AS events,
  COALESCE(o.with_stdout, 0)     AS with_stdout,
  COALESCE(o.with_decision, 0)   AS with_decision,
  COALESCE(o.nonzero_exit, 0)    AS nonzero_exit,
  COALESCE(o.blocks, 0)          AS blocks,
  COALESCE(r.gated_stops, 0)     AS gated_stops
FROM runs r
FULL OUTER JOIN observed o ON o.host = r.host AND o.command = r.command
ORDER BY fires DESC, total_ms DESC, host;
