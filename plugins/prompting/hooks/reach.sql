-- Reach of the load-nudge hook: per week and main/subagent, units that edited a document a
-- model executes, and how many loaded `skill` before the first edit, within `window_minutes`
-- of it, or ever, plus how many the hook nudged and how many loaded after the nudge. A unit
-- is a main session or one subagent (`agent_id`). Run against the session index:
--   duckdb -readonly ~/.local/share/claude-sessions/session.duckdb \
--     -cmd "SET VARIABLE after_date = '2026-11-19'" -cmd "SET VARIABLE host = 'local'" < reach.sql
-- The `cloud` host is stale since 2026-10-30, so scope it out with `host` for recent windows.
WITH params AS (
  SELECT
    COALESCE(TRY_CAST(getvariable('skill') AS VARCHAR), 'prompting:prompting') AS skill,
    COALESCE(
      TRY_CAST(getvariable('path_regex') AS VARCHAR),
      '(^|/)(SKILL|CLAUDE|AGENTS)\.md$|/(rules|agents)/[^/]+\.md$|/skills/[^/]+/references/'
    ) AS path_regex,
    COALESCE(TRY_CAST(getvariable('window_minutes') AS INTEGER), 10) AS window_minutes
),
edits AS (
  SELECT tc.host, tc.session_id, tc.agent_id, MIN(tc.timestamp) AS first_edit
  FROM tool_calls tc
  JOIN scoped_sessions() s USING (host, session_id)
  CROSS JOIN params p
  WHERE tc.tool_name IN ('Edit', 'Write', 'MultiEdit')
    AND regexp_matches(tc.file_path, p.path_regex)
  GROUP BY ALL
),
loads AS (
  SELECT sl.host, sl.session_id, sl.agent_id, MIN(sl.timestamp) AS first_load
  FROM skill_loads sl
  CROSS JOIN params p
  WHERE sl.skill = p.skill AND sl.trigger <> 'compaction'
  GROUP BY ALL
),
nudges AS (
  SELECT he.host, he.session_id, MIN(he.timestamp) AS first_nudge
  FROM hook_events he
  CROSS JOIN params p
  WHERE contains(he.additional_context, p.skill)
  GROUP BY ALL
),
units AS (
  SELECT e.*, l.first_load, n.first_nudge
  FROM edits e
  LEFT JOIN loads l
    ON l.host = e.host AND l.session_id = e.session_id
   AND l.agent_id IS NOT DISTINCT FROM e.agent_id
  LEFT JOIN nudges n ON n.host = e.host AND n.session_id = e.session_id
)
SELECT
  date_trunc('week', first_edit)::DATE AS week,
  agent_id IS NOT NULL AS subagent,
  COUNT(*) AS edit_units,
  COUNT(*) FILTER (WHERE first_load <= first_edit) AS loaded_before_edit,
  COUNT(*) FILTER (
    WHERE first_load <= first_edit + to_minutes((SELECT window_minutes FROM params))
  ) AS loaded_by_window,
  COUNT(first_load) AS loaded_ever,
  COUNT(first_nudge) AS nudged,
  COUNT(*) FILTER (WHERE first_load >= first_nudge) AS loaded_after_nudge
FROM units
GROUP BY ALL
ORDER BY week, subagent;
