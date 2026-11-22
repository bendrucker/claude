-- ---
-- name: idle-compactions
-- summary: >-
--   One row per idle compaction: its pre-compaction tokens, the minutes until the next
--   prompt (NULL when none followed), and the skill bodies re-injected after it.
-- description: >-
--   Idle compaction (CLI ~2.1.290+) summarizes a 200K+ token session idle about 54 minutes,
--   before its 1h prompt cache expires. It is worth its cost only when the session is
--   resumed, so `minutes_to_next_prompt` is the measure: NULL means no prompt followed,
--   and a large value means the cache would have expired anyway. `in_window_band` flags
--   `compact_pre_tokens` in `[200000, autoCompactWindow)`, the band that never compacted
--   before idle compaction existed. `reinjected_skills` and `reinjected_bytes` count
--   `skill_loads` with `trigger = 'compaction'` between this boundary and the next one;
--   the harness writes them at the boundary, but their tokens are billed only on the next
--   request. `next_prompt_source` separates a typed resume from an automated one.
-- params:
--   - name: window
--     default: 280000
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH all_compactions AS (
  SELECT *,
         LEAD(timestamp) OVER (PARTITION BY host, source_file ORDER BY source_line) AS next_compaction_at
  FROM compactions
),
idle AS (
  SELECT *
  FROM all_compactions
  WHERE kind = 'idle'
    AND date_filter(timestamp, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(project_path, getvariable('project'))
    AND host_filter(host, getvariable('host'))
),
next_prompt AS (
  SELECT i.host, i.uuid,
         min(m.timestamp)                    AS next_prompt_at,
         arg_min(m.prompt_source, m.timestamp) AS next_prompt_source
  FROM idle i
  JOIN messages m
    ON m.host = i.host AND m.session_id = i.session_id
   AND m.type = 'user' AND m.prompt_source IS NOT NULL
   AND NOT coalesce(m.is_sidechain, false)
   AND m.timestamp > i.timestamp
  GROUP BY i.host, i.uuid
),
reinjected AS (
  SELECT i.host, i.uuid,
         count(*)          AS reinjected_skills,
         sum(sl.body_bytes) AS reinjected_bytes
  FROM idle i
  JOIN skill_loads sl
    ON sl.host = i.host AND sl.session_id = i.session_id
   AND sl.trigger = 'compaction'
   AND sl.agent_id IS NOT DISTINCT FROM i.agent_id
   AND sl.timestamp >= i.timestamp
   AND (i.next_compaction_at IS NULL OR sl.timestamp < i.next_compaction_at)
  GROUP BY i.host, i.uuid
)
SELECT
  i.host,
  i.session_id,
  i.project_path,
  i.timestamp,
  i.compact_pre_tokens,
  i.compact_post_tokens,
  i.compact_pre_tokens >= 200000
    AND i.compact_pre_tokens < COALESCE(TRY_CAST(getvariable('window') AS BIGINT), 280000) AS in_window_band,
  round(date_diff('second', i.timestamp, np.next_prompt_at) / 60.0, 1) AS minutes_to_next_prompt,
  np.next_prompt_source,
  coalesce(r.reinjected_skills, 0) AS reinjected_skills,
  coalesce(r.reinjected_bytes, 0)  AS reinjected_bytes
FROM idle i
LEFT JOIN next_prompt np ON np.host = i.host AND np.uuid = i.uuid
LEFT JOIN reinjected r   ON r.host = i.host  AND r.uuid = i.uuid
ORDER BY i.timestamp;
