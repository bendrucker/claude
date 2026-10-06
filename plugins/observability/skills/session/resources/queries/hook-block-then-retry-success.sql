-- ---
-- name: hook-block-then-retry-success
-- tier: 1
-- dimensions: [hook-blocks]
-- summary: >-
--   Per hook, blocks that were retried away by a same-hook success in the same session
--   within N seconds: noise rather than a genuine redirect.
-- description: >-
--   Groups by hook and reports total blocks against how many were retried away, with the
--   retry rate. A high rate means the gate mostly annoys. A low rate means it actually
--   stops work.
-- params:
--   - name: hook
--     meaning: GLOB on the hook key
--   - name: within_seconds
--     default: 300
--     meaning: the retry window
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
-- NULL-safety matters here: `blocked` is NULL for most success rows (the view's boolean
-- is NULL when `decision` is NULL), so `NOT blocked` would exclude essentially every
-- success; use `blocked IS NOT TRUE` plus the `hook_success` kind check. Stop rows are
-- keyed by `hook_event` because blocked Stop events carry NULL `command` while Stop
-- successes carry it, so a command-based key never aligns the two sides.
WITH ev AS (
  SELECT
    he.host,
    he.session_id,
    he.timestamp AS ts,
    CASE WHEN he.hook_event = 'Stop' THEN he.hook_event
         ELSE COALESCE(he.command, he.hook_name, he.hook_event) END AS hook,
    he.kind,
    he.blocked
  FROM hook_events he
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
),
filtered AS (
  SELECT * FROM ev
  WHERE getvariable('hook') IS NULL OR hook GLOB getvariable('hook')::VARCHAR
),
blk AS (
  SELECT
    b.host,
    b.hook,
    EXISTS (
      SELECT 1 FROM filtered s
      WHERE s.host = b.host
        AND s.session_id = b.session_id
        AND s.hook = b.hook
        AND s.kind = 'hook_success'
        AND s.blocked IS NOT TRUE
        AND epoch(s.ts) > epoch(b.ts)
        AND epoch(s.ts) - epoch(b.ts) < COALESCE(getvariable('within_seconds'), 300)
    ) AS retried_away
  FROM filtered b
  WHERE b.blocked IS TRUE
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
