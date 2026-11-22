-- ---
-- name: subagent-effort
-- dimensions: [tokens]
-- summary: >-
--   Spawn count, model, tokens, cost, and wall time per subagent type and the effort level
--   it actually ran at.
-- description: >-
--   One row per (`subagent_type`, `effort`, `model`). `effort` is the modal `effort` field
--   on the subagent transcript's assistant records, which reports the level that ran after
--   frontmatter, `CLAUDE_CODE_SUBAGENT_EFFORT`, and session inheritance resolve, so it is
--   the baseline for deciding whether to pin `effort:` on an agent definition. `NULL`
--   effort means the transcript predates the field or the spawn left no transcript.
--
--   Tokens and cost sum `message_usage` over the subagent's own transcript. `median_wall_s`
--   spans the transcript's first to last record, so it includes tool time and works for
--   background spawns, whose tool result carries no duration. `fork` spawns are excluded,
--   as in `delegation`.
-- params:
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH calls AS (
  SELECT
    ci.host,
    ci.session_id,
    ci.id AS tool_id,
    COALESCE(ci.data->>'$.input.subagent_type', 'general-purpose') AS subagent_type
  FROM content_items ci
  JOIN scoped_sessions() s USING (host, session_id)
  WHERE ci.type = 'tool_use'
    AND ci.name IN ('Agent', 'Task')
    AND COALESCE(ci.data->>'$.input.subagent_type', '') != 'fork'
),
results AS (
  SELECT r.host, r.tool_use_id AS tool_id, r.tool_use_result->>'$.agentId' AS agent_id
  FROM content_items r
  WHERE r.type = 'tool_result'
),
transcripts AS (
  SELECT
    host, session_id,
    regexp_extract(source_file, 'agent-([^/]+)\.jsonl$', 1) AS agent_id,
    mode(data->>'$.effort') FILTER (WHERE type = 'assistant') AS effort,
    mode(model) FILTER (WHERE type = 'assistant')             AS model,
    date_diff('millisecond', MIN(timestamp), MAX(timestamp)) / 1000.0 AS wall_s
  FROM raw
  WHERE source_file LIKE '%/subagents/%agent-%.jsonl'
  GROUP BY 1, 2, 3
),
usage AS (
  SELECT
    host, session_id,
    regexp_extract(source_file, 'agent-([^/]+)\.jsonl$', 1) AS agent_id,
    SUM(COALESCE(output_tokens, 0)) AS output_tokens,
    SUM(est_cost_usd)               AS est_cost_usd
  FROM message_usage
  WHERE source_file LIKE '%/subagents/%agent-%.jsonl'
  GROUP BY 1, 2, 3
),
per_spawn AS (
  SELECT
    c.subagent_type,
    t.effort,
    model_family(t.model) AS model,
    t.wall_s,
    u.output_tokens,
    u.est_cost_usd
  FROM calls c
  LEFT JOIN results res USING (host, tool_id)
  LEFT JOIN transcripts t
    ON t.host = c.host AND t.session_id = c.session_id AND t.agent_id = res.agent_id
  LEFT JOIN usage u
    ON u.host = c.host AND u.session_id = c.session_id AND u.agent_id = res.agent_id
)
SELECT
  subagent_type,
  effort,
  model,
  COUNT(*)                                AS spawns,
  ROUND(median(output_tokens))::BIGINT    AS median_output_tokens,
  ROUND(median(wall_s), 1)                AS median_wall_s,
  ROUND(SUM(est_cost_usd), 4)             AS est_cost_usd
FROM per_spawn
GROUP BY subagent_type, effort, model
ORDER BY spawns DESC, subagent_type, effort;
