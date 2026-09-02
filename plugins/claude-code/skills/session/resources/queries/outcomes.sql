-- ---
-- name: outcomes
-- tier: 1
-- dimensions: [outcomes]
-- summary: >-
--   Session terminal states (shipped, abandoned-with-edits, handed off, no artifact), the
--   outcome side the activity queries never measure.
-- description: >-
--   `shipped` is a pr-link record or a ship-signal Bash command (`git push`, `gh pr
--   create/merge`, `glab mr create/merge`). `ongoing` ended within `ongoing_hours` of the
--   corpus horizon, too fresh to call. `handed-off` is a session whose last plan was
--   rejected with no edits after it, the deliberate plan-here-implement-elsewhere pattern.
--   `abandoned-with-edits` is file edits with nothing shipped, the real loss signal.
--   `no-artifact` is neither, e.g. Q&A, analysis, or discovery. Shipped means opened or
--   pushed, not merged. PR fate after the session ends lives outside the index.
--
--   Also counts distinct PRs opened and PRs that took more than one session, a rework
--   proxy. Reads DISTINCT `(host, session_id)` pairs from `pr_links`, so duplicate link
--   emissions never inflate the counts.
-- params:
--   - name: ongoing_hours
--     default: 48
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH base AS (
  SELECT *
  FROM sessions
  WHERE date_filter(start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(project_path, getvariable('project'))
    AND host_filter(host, getvariable('host'))
),
ship AS (
  SELECT DISTINCT host, session_id FROM pr_links
  UNION
  SELECT DISTINCT host, session_id
  FROM tool_calls
  WHERE tool_name = 'Bash'
    AND regexp_matches(command, 'git push|gh pr (create|merge)|glab mr (create|merge)')
),
edits AS (
  SELECT host, session_id, COUNT(*) AS n
  FROM file_operations
  WHERE operation IN ('Write', 'Edit', 'MultiEdit', 'NotebookEdit')
  GROUP BY host, session_id
),
last_plan AS (
  SELECT host, session_id, arg_max(outcome, plan_seq) AS last_outcome
  FROM plan_calls
  GROUP BY host, session_id
),
-- The horizon is corpus-wide, not filter-scoped: a session is "too fresh to call"
-- relative to the newest data the index has, regardless of the window being queried.
horizon AS (SELECT MAX(end_time) AS t FROM sessions),
classified AS (
  SELECT
    b.host,
    b.session_id,
    CASE
      WHEN s.session_id IS NOT NULL THEN 'shipped'
      WHEN b.end_time >= (SELECT t FROM horizon)
        - to_hours(COALESCE(TRY_CAST(getvariable('ongoing_hours') AS INTEGER), 48))
        THEN 'ongoing'
      WHEN lp.last_outcome = 'handoff' THEN 'handed-off'
      WHEN COALESCE(e.n, 0) > 0 THEN 'abandoned-with-edits'
      ELSE 'no-artifact'
    END AS state
  FROM base b
  LEFT JOIN ship s USING (host, session_id)
  LEFT JOIN edits e USING (host, session_id)
  LEFT JOIN last_plan lp USING (host, session_id)
),
prs AS (
  SELECT p.url, COUNT(DISTINCT (p.host, p.session_id)) AS sessions_per_pr
  FROM (SELECT DISTINCT host, session_id, url FROM pr_links) p
  JOIN base b USING (host, session_id)
  GROUP BY p.url
)
SELECT metric, count
FROM (
  SELECT 'sessions: ' || state AS metric, COUNT(*) AS count, 1 AS ord
  FROM classified GROUP BY state
  UNION ALL
  SELECT 'prs opened (distinct urls)', COUNT(*), 2 FROM prs
  UNION ALL
  SELECT 'prs needing multiple sessions', COUNT(*) FILTER (WHERE sessions_per_pr > 1), 3
  FROM prs
) t
ORDER BY ord, count DESC, metric;
