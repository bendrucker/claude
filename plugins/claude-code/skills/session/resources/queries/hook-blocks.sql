-- ---
-- name: hook-blocks
-- tier: 1
-- summary: >-
--   Hook overfiring, blocking events grouped by hook and normalized reason signature,
--   including the PreToolUse denies `hook_events` never records.
-- description: >-
--   Quoted spans and whitespace are collapsed into the signature, so a hook that fires on
--   many targets with the same message aggregates into one row. `storm_threads` counts
--   threads where the same signature blocked two or more times (the model getting blocked,
--   retrying, and blocked again) and `max_burst` is the worst single thread. Together they
--   distinguish a smooth one-shot redirect from a hook the model fights.
--
--   A thread is `(host, session_id, agent_id)`, not the session alone. A subagent writes
--   its own transcript but stamps every line with the parent session's id, so keying the
--   burst on `session_id` sums an entire fan-out's blocks into one number and reports a
--   storm the parent never experienced. Denies from n independent subagents that each hit a
--   hook once are n one-shot redirects rather than a burst of n. `subagent_blocks` reports
--   how much of the row came from subagents and `agent_threads` counts the distinct
--   contexts blocked, both alongside an unchanged total `blocks`.
--
--   Two instruments feed this, because one of them is blind to the most common block. A
--   PreToolUse hook returning `permissionDecision: deny` writes no hook record at all, so
--   `hook_blocks` misses it entirely and `hook_denies` recovers it from the denied call's
--   tool_result. `ask` decisions and exit-2 blocks are recorded normally.
--   `recovered_denies` counts the rows that came back the recovered way. A hook whose
--   blocks are entirely recovered would otherwise read as zero. Those rows key on the
--   pattern map's hook label rather than a command string, so one hook can appear under
--   both its label and its command when it both denies and asks.
--
--   `first_seen` and `last_seen` bound the span a signature covers. A hook that was fixed
--   mid-window keeps accumulating its old blocks in the aggregate forever, so a row whose
--   `last_seen` predates the fix describes a closed bug. Check the span against the hook's
--   git history before citing a count.
-- params:
--   - name: hook
--     meaning: GLOB on command/name
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
-- The recovery rules and the hand-maintained pattern map behind `hook_denies` are
-- documented on the view in views.sql.
WITH blocks AS (
  SELECT host, session_id, agent_id, timestamp, hook_event, hook_name, command,
         kind, decision, reason
  FROM hook_blocks
  UNION ALL
  SELECT host, session_id, agent_id, timestamp, hook_event, hook_name, NULL AS command,
         'tool_error_deny' AS kind, 'deny' AS decision, reason
  FROM hook_denies
),
bl AS (
  SELECT
    hb.*,
    COALESCE(hb.command, hb.hook_name) AS hook,
    substr(
      regexp_replace(
        regexp_replace(trim(COALESCE(hb.reason, '(no reason)')), '"[^"]*"', '"_"', 'g'),
        '\s+', ' ', 'g'
      ), 1, 80
    ) AS signature
  FROM blocks hb
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
    AND (getvariable('hook') IS NULL OR COALESCE(hb.command, hb.hook_name) GLOB getvariable('hook')::VARCHAR)
),
per_thread AS (
  SELECT hook, signature, host, session_id, agent_id, COUNT(*) AS n
  FROM bl
  GROUP BY hook, signature, host, session_id, agent_id
),
storms AS (
  SELECT hook, signature, COUNT(*) FILTER (WHERE n >= 2) AS storm_threads, MAX(n) AS max_burst
  FROM per_thread
  GROUP BY hook, signature
)
SELECT
  bl.hook,
  bl.signature,
  COUNT(*)                                          AS blocks,
  COUNT(*) FILTER (WHERE bl.decision IN ('deny', 'block')) AS denies,
  COUNT(*) FILTER (WHERE bl.decision = 'ask')       AS asks,
  COUNT(*) FILTER (WHERE bl.kind = 'tool_error_deny') AS recovered_denies,
  COUNT(*) FILTER (WHERE bl.agent_id IS NOT NULL)   AS subagent_blocks,
  COUNT(DISTINCT (bl.host, bl.session_id))          AS sessions,
  COUNT(DISTINCT (bl.host, bl.session_id, bl.agent_id)) AS agent_threads,
  st.storm_threads,
  st.max_burst,
  string_agg(DISTINCT bl.hook_event, ',')           AS events,
  MIN(bl.timestamp)                                 AS first_seen,
  MAX(bl.timestamp)                                 AS last_seen
FROM bl
JOIN storms st USING (hook, signature)
GROUP BY bl.hook, bl.signature, st.storm_threads, st.max_burst
ORDER BY blocks DESC, bl.hook;
