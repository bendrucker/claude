-- Work attributed to each skill: how much of your activity (and token spend) each skill
-- drives. Attribution is on the assistant messages produced while a skill is active, so
-- this captures the skill's real footprint, not just explicit Skill-tool invocations.
-- Swap `attribution_skill` for `attribution_plugin` or `attribution_agent` to re-cut.
-- Params: after_date, before_date, project, host.
WITH m AS (
  SELECT msg.*
  FROM messages msg
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
    AND msg.attribution_skill IS NOT NULL
)
SELECT
  attribution_skill AS skill,
  COUNT(*) FILTER (WHERE type = 'assistant')  AS assistant_turns,
  COUNT(DISTINCT (host, session_id))          AS sessions,
  SUM(COALESCE(output_tokens, 0))             AS output_tokens,
  SUM(COALESCE(input_tokens, 0))              AS input_tokens,
  SUM(COALESCE(cache_read_tokens, 0))         AS cache_read_tokens,
  MAX(timestamp)                              AS last_seen
FROM m
GROUP BY skill
ORDER BY output_tokens DESC, skill;
