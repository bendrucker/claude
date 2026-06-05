-- Hook blocks that were followed by a same-hook *success* in the same session within N
-- seconds: a block the model simply retried away, which is noise rather than a genuine
-- redirect. Groups by hook (command, or hook_name when no command) and reports total
-- blocks against how many were retried away, with the retry rate. A high rate means the
-- gate mostly annoys; a low rate means it actually stops work. The windowed
-- self-correlation is the hard part to rewrite from memory.
-- Params: after_date, before_date, project, host, hook (GLOB on command/name),
-- within_seconds (window, default 300).
WITH ev AS (
  SELECT
    he.host,
    he.session_id,
    he.timestamp AS ts,
    COALESCE(he.command, he.hook_name) AS hook,
    he.blocked
  FROM hook_events he
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
    AND (getvariable('hook') IS NULL OR COALESCE(he.command, he.hook_name) GLOB getvariable('hook')::VARCHAR)
),
blk AS (
  SELECT
    b.host,
    b.hook,
    EXISTS (
      SELECT 1 FROM ev s
      WHERE s.host = b.host
        AND s.session_id = b.session_id
        AND s.hook = b.hook
        AND NOT s.blocked
        AND epoch(s.ts) > epoch(b.ts)
        AND epoch(s.ts) - epoch(b.ts) < COALESCE(getvariable('within_seconds'), 300)
    ) AS retried_away
  FROM ev b
  WHERE b.blocked
)
SELECT
  host,
  hook,
  COUNT(*)                                          AS total_blocks,
  COUNT(*) FILTER (WHERE retried_away)              AS followed_by_success,
  ROUND(100.0 * COUNT(*) FILTER (WHERE retried_away) / COUNT(*), 1) AS retry_pct
FROM blk
GROUP BY host, hook
ORDER BY total_blocks DESC, hook;
