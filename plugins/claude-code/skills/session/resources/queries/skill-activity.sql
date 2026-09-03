-- ---
-- name: skill-activity
-- tier: 1
-- summary: >-
--   Work attributed to each skill: assistant turns, sessions, and input, output, and cache
--   tokens.
-- description: >-
--   Attribution is on the assistant messages produced while a skill is active, so this
--   captures the skill's real footprint rather than just explicit Skill-tool invocations.
--   Tokens are deduped per message via `message_usage`, because raw rows repeat the parent
--   message's usage. Swap `attribution_skill` for `attribution_plugin` or
--   `attribution_agent` in the SQL to re-cut.
-- params:
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH m AS (
  SELECT mu.*
  FROM message_usage mu
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
    AND mu.attribution_skill IS NOT NULL
)
SELECT
  attribution_skill AS skill,
  COUNT(*)                                    AS assistant_turns,
  COUNT(DISTINCT (host, session_id))          AS sessions,
  SUM(COALESCE(output_tokens, 0))             AS output_tokens,
  SUM(COALESCE(input_tokens, 0))              AS input_tokens,
  SUM(COALESCE(cache_read_tokens, 0))         AS cache_read_tokens,
  MAX(timestamp)                              AS last_seen
FROM m
GROUP BY skill
ORDER BY output_tokens DESC, skill;
