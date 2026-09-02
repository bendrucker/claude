-- ---
-- name: plan-iterations
-- tier: 1
-- summary: >-
--   One row per ExitPlanMode present, ordered within a session, measuring the append-only
--   re-present signature.
-- description: >-
--   Measures growth (`chars_delta`, `lines_added`), removal (`lines_removed`), and
--   carry-over (`lines_carried`, `carry_over_ratio`) against the previous present via set
--   comparison of normalized plan text, plus time to the first present
--   (`secs_to_first_plan`) and the session's human-authored prompt count (`human_msgs`).
--   Line comparison is set-based (trim, drop empty lines, DISTINCT) rather than multiset,
--   so a line repeated within a plan counts once. High `carry_over_ratio` paired with
--   positive `lines_added` and near-zero `lines_removed` is the append-only pattern the
--   plan iteration guidance (#942) and re-present gate (#943) exist to prevent.
-- params:
--   - name: min_plans
--     default: 2
--     meaning: >-
--       minimum plan_count per session, defaulting to 2 because the query is about
--       re-presents and a session with a single present carries no iteration signal
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH filtered AS (
  SELECT ps.host, ps.session_id
  FROM plan_sessions ps
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(ps.project_path, getvariable('project'))
    AND host_filter(ps.host, getvariable('host'))
    AND ps.plan_count >= COALESCE(TRY_CAST(getvariable('min_plans') AS INTEGER), 2)
),
plans AS (
  SELECT
    pc.host,
    pc.session_id,
    pc.project_path,
    pc.timestamp,
    pc.plan_seq,
    pc.outcome,
    pc.plan_chars,
    json_extract_string(ci.data, '$.input.plan') AS plan_text
  FROM plan_calls pc
  JOIN filtered f ON f.host = pc.host AND f.session_id = pc.session_id
  JOIN content_items ci
    ON ci.host = pc.host
   AND ci.id = pc.tool_use_id
  WHERE ci.type = 'tool_use'
    AND ci.name = 'ExitPlanMode'
),
windowed AS (
  SELECT
    p.*,
    LAG(p.plan_chars) OVER w AS prev_chars,
    LAG(p.timestamp)  OVER w AS prev_ts
  FROM plans p
  WINDOW w AS (PARTITION BY p.host, p.session_id ORDER BY p.plan_seq)
),
plan_lines AS (
  SELECT DISTINCT
    p.host, p.session_id, p.plan_seq, trim(t.line) AS line
  FROM plans p,
  LATERAL (SELECT unnest(string_split(p.plan_text, chr(10))) AS line) t
  WHERE trim(t.line) <> ''
),
diffs AS (
  SELECT
    host,
    session_id,
    plan_seq,
    list(line)                AS lines,
    COUNT(*)                  AS distinct_lines,
    LAG(list(line)) OVER w    AS prev_lines
  FROM plan_lines
  GROUP BY host, session_id, plan_seq
  WINDOW w AS (PARTITION BY host, session_id ORDER BY plan_seq)
),
first_plan AS (
  SELECT host, session_id, MIN(timestamp) AS first_plan_ts
  FROM plan_calls
  WHERE plan_seq = 1
  GROUP BY host, session_id
),
first_plan_mode AS (
  SELECT r.host, r.session_id, MIN(r.timestamp) AS first_plan_mode_ts
  FROM records r
  JOIN filtered f ON f.host = r.host AND f.session_id = r.session_id
  WHERE r.permission_mode = 'plan'
  GROUP BY r.host, r.session_id
),
human_prompts AS (
  SELECT r.host, r.session_id, COUNT(*) AS human_msgs
  FROM records r
  JOIN filtered f ON f.host = r.host AND f.session_id = r.session_id
  WHERE r.type = 'last-prompt'
  GROUP BY r.host, r.session_id
)
SELECT
  w.host,
  substr(w.session_id, 1, 8)          AS sid,
  SPLIT_PART(w.project_path, '/', -1) AS project,
  w.plan_seq,
  w.outcome,
  w.plan_chars,
  w.plan_chars - w.prev_chars         AS chars_delta,
  CASE WHEN d.prev_lines IS NULL THEN NULL
       ELSE len(list_filter(d.lines, x -> NOT list_contains(d.prev_lines, x)))
  END                                  AS lines_added,
  CASE WHEN d.prev_lines IS NULL THEN NULL
       ELSE len(list_filter(d.prev_lines, x -> NOT list_contains(d.lines, x)))
  END                                  AS lines_removed,
  CASE WHEN d.prev_lines IS NULL THEN NULL
       ELSE len(list_filter(d.lines, x -> list_contains(d.prev_lines, x)))
  END                                  AS lines_carried,
  CASE WHEN d.prev_lines IS NULL THEN NULL
       ELSE ROUND(
         len(list_filter(d.lines, x -> list_contains(d.prev_lines, x)))::DOUBLE
           / NULLIF(d.distinct_lines, 0),
         2
       )
  END                                  AS carry_over_ratio,
  CASE WHEN w.prev_ts IS NULL THEN NULL
       ELSE date_diff('second', w.prev_ts, w.timestamp)
  END                                  AS secs_since_prev,
  CASE WHEN fpm.first_plan_mode_ts IS NULL THEN NULL
       ELSE date_diff('second', fpm.first_plan_mode_ts, fp.first_plan_ts)
  END                                  AS secs_to_first_plan,
  COALESCE(hp.human_msgs, 0)          AS human_msgs
FROM windowed w
JOIN diffs d USING (host, session_id, plan_seq)
JOIN first_plan fp USING (host, session_id)
LEFT JOIN first_plan_mode fpm USING (host, session_id)
LEFT JOIN human_prompts hp USING (host, session_id)
ORDER BY w.host, w.session_id, w.plan_seq;
