-- One row per git:conflicts invocation: the span from the Skill call to the next typed or queued prompt in the session (or its end).
CREATE OR REPLACE TEMP TABLE spans AS
WITH calls AS (
  SELECT session_id, project_path, timestamp AS t0, tool_id
  FROM skill_calls WHERE skill_name = 'git:conflicts'
),
bounded AS (
  SELECT c.*,
    (SELECT min(m.timestamp) FROM messages m
     WHERE m.session_id = c.session_id AND m.type = 'user'
       AND m.prompt_source IN ('typed', 'queued', 'sdk') AND m.timestamp > c.t0) AS next_prompt,
    (SELECT max(m.timestamp) FROM messages m WHERE m.session_id = c.session_id) AS session_end
  FROM calls c
)
SELECT *, coalesce(next_prompt, session_end) AS t1,
  CASE WHEN project_path ILIKE '%bendrucker/claude%' THEN 'claude'
       WHEN project_path ILIKE '%dotfiles%' THEN 'dotfiles' ELSE 'work repo' END AS repo
FROM bounded;

-- Cost includes sidechain turns, so a forked resolution's subagent counts toward its invocation.
CREATE OR REPLACE TEMP TABLE span_usage AS
SELECT s.tool_id, s.repo, s.session_id, s.t0, s.t1,
  date_diff('second', s.t0, s.t1) AS secs,
  any_value(u.model) FILTER (WHERE NOT u.is_sidechain) AS model,
  sum(u.est_cost_usd) AS cost,
  sum(u.est_cost_usd) FILTER (WHERE u.is_sidechain) AS sub_cost,
  sum(u.output_tokens) AS out_tok,
  sum(u.cache_read_tokens) AS cache_read,
  sum(u.cache_creation_tokens) AS cache_write,
  sum(u.input_tokens) AS input_tok,
  count(*) FILTER (WHERE NOT u.is_sidechain) AS turns
FROM spans s
JOIN message_usage u ON u.session_id = s.session_id AND u.timestamp >= s.t0 AND u.timestamp <= s.t1
GROUP BY ALL;

SELECT model, date_trunc('week', t0) AS week, count(*) AS n,
  round(median(cost), 2) AS median_cost,
  round(median(sub_cost), 2) AS median_sub_cost,
  median(turns) AS median_turns
FROM span_usage
GROUP BY ALL
ORDER BY model, week;
