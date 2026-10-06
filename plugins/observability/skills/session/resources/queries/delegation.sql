-- ---
-- name: delegation
-- tier: 1
-- dimensions: [tokens]
-- summary: >-
--   Whether expensive orchestrator sessions push work down to cheaper models on Agent/Task
--   spawns.
-- description: >-
--   One row per (parent main-model family, `path`, actual spawn-model family). `path`
--   splits `pinned` (purpose-built agents that set a `model:` in their own definition,
--   re-derivable from the `model` column of `bun run inventory agents` plus the built-in
--   `claude-code-guide`) from `generic` (`general-purpose`, `Plan`, bare `claude`,
--   `Explore`, any subagent type off that list). A purpose-built agent with no frontmatter
--   `model:` (`review:angle`, `review:verifier`) counts as generic, because its spawn site
--   still has to supply the model. `Explore` counts as generic, not pinned: since CLI
--   v2.1.198 it inherits the parent model (capped at Opus) rather than pinning Haiku, so an
--   Explore spawn under an expensive parent is a real delegation miss. Unrecognized types
--   default to generic, so the split undercounts `pinned` rather than overstating the
--   generic-path miss. The generic path is where delegation actually happens or fails,
--   because a pinned agent's model is fixed by its own definition.
--
--   `override_rate_pct` and `cheaper_override_rate_pct` divide by every spawn in the group,
--   so they read as how much of that group's delegation was steered. A cheaper override is
--   an explicit `model` input naming a family cheaper than the parent's dominant model,
--   compared via `model_output_rate`.
--
--   Blind spots. `fork` subagents are excluded, since a fork inherits the parent model by
--   design and never carries an explicit override. The actual spawn model comes from the
--   tool result's `resolvedModel` when present and otherwise from the modal model of the
--   subagent's own transcript, so spawns with neither signal (still running, cancelled)
--   land in `actual_family = unknown` and belong out of the denominator when reading a
--   family's expensive share off `pct_of_path`. `expensive_output_tokens` and
--   `expensive_cache_creation_tokens` sum `message_usage` tokens for spawns whose actual
--   family resolved to opus or fable, an upper bound on wasted spend rather than a verdict,
--   since some opus subagent work is warranted. The parent's main model is the modal model
--   across the session's non-sidechain assistant messages, so a mid-session `/model` switch
--   flattens into whichever model produced more turns.
-- params:
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH session_main AS (
  SELECT
    mu.host,
    mu.session_id,
    mode(mu.model) AS main_model
  FROM message_usage mu
  JOIN sessions s USING (host, session_id)
  WHERE NOT mu.is_sidechain
    AND date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
  GROUP BY mu.host, mu.session_id
),
-- Inner join to session_main both attaches the parent's main model and applies
-- date/project/host scoping to the calls themselves (session_main already filtered on
-- those params); a left join here would let calls from an out-of-scope host or date
-- range leak in with a NULL main_model and inflate `parent_family = 'unknown'`.
calls AS (
  SELECT
    ci.host,
    ci.session_id,
    ci.id AS tool_id,
    sm.main_model,
    (ci.data->>'$.input.subagent_type') AS subagent_type,
    (ci.data->>'$.input.model')         AS model_override
  FROM content_items ci
  JOIN session_main sm ON sm.host = ci.host AND sm.session_id = ci.session_id
  WHERE ci.type = 'tool_use'
    AND ci.name IN ('Agent', 'Task')
    AND COALESCE((ci.data->>'$.input.subagent_type'), '') != 'fork'
),
results AS (
  SELECT
    r.host,
    r.tool_use_id AS tool_id,
    (r.tool_use_result->>'$.agentId')       AS agent_id,
    (r.tool_use_result->>'$.resolvedModel') AS resolved_model
  FROM content_items r
  WHERE r.type = 'tool_result'
),
joined AS (
  SELECT c.*, res.agent_id, res.resolved_model
  FROM calls c
  LEFT JOIN results res USING (host, tool_id)
),
-- Subagent transcript files are named `agent-<agentId>.jsonl` under a `subagents/`
-- directory (occasionally nested one level deeper under a workflow id), so the id is
-- extracted once per file with a regex and joined by equality rather than a per-call
-- LIKE scan, which is the difference between one pass over the sidechain rows and
-- O(calls x sidechain rows).
subagent_models AS (
  SELECT
    host, session_id,
    regexp_extract(source_file, 'agent-([^/]+)\.jsonl$', 1) AS agent_id,
    mode((data->>'$.message.model')) AS modal_model
  FROM raw
  WHERE type = 'assistant' AND source_file LIKE '%/subagents/%agent-%.jsonl'
  GROUP BY 1, 2, 3
),
subagent_tokens AS (
  SELECT
    host, session_id,
    regexp_extract(source_file, 'agent-([^/]+)\.jsonl$', 1) AS agent_id,
    SUM(COALESCE(output_tokens, 0))         AS output_tokens,
    SUM(COALESCE(cache_creation_tokens, 0)) AS cache_creation_tokens
  FROM message_usage
  WHERE source_file LIKE '%/subagents/%agent-%.jsonl'
  GROUP BY 1, 2, 3
),
per_call AS (
  SELECT
    COALESCE(model_family(j.main_model), 'unknown') AS parent_family,
    CASE
      WHEN j.subagent_type IN (
        'analyst', 'claude-code-guide', 'github:logs', 'gitlab:logs',
        'github:rulesets-manager', 'type-ignore:fixer',
        'writing:artifacts', 'writing:content', 'writing:style'
      ) THEN 'pinned'
      ELSE 'generic'
    END AS path,
    COALESCE(model_family(j.resolved_model), model_family(sm.modal_model), 'unknown') AS actual_family,
    j.model_override IS NOT NULL AS has_override,
    j.model_override IS NOT NULL
      AND model_output_rate(j.model_override) < model_output_rate(j.main_model)       AS has_cheaper_override,
    COALESCE(st.output_tokens, 0)         AS output_tokens,
    COALESCE(st.cache_creation_tokens, 0) AS cache_creation_tokens
  FROM joined j
  LEFT JOIN subagent_models sm
    ON sm.host = j.host AND sm.session_id = j.session_id AND sm.agent_id = j.agent_id
  LEFT JOIN subagent_tokens st
    ON st.host = j.host AND st.session_id = j.session_id AND st.agent_id = j.agent_id
)
SELECT
  parent_family,
  path,
  actual_family,
  COUNT(*)                                               AS spawns,
  SUM(COUNT(*)) OVER (PARTITION BY parent_family, path)  AS path_spawns,
  ROUND(100.0 * COUNT(*)
    / SUM(COUNT(*)) OVER (PARTITION BY parent_family, path), 1) AS pct_of_path,
  ROUND(100.0 * SUM(SUM(has_override::INT)) OVER (PARTITION BY parent_family, path)
    / SUM(COUNT(*)) OVER (PARTITION BY parent_family, path), 1) AS override_rate_pct,
  ROUND(100.0 * SUM(SUM(has_cheaper_override::INT)) OVER (PARTITION BY parent_family, path)
    / SUM(COUNT(*)) OVER (PARTITION BY parent_family, path), 1) AS cheaper_override_rate_pct,
  COALESCE(SUM(SUM(output_tokens) FILTER (WHERE actual_family IN ('opus', 'fable')))
    OVER (PARTITION BY parent_family, path), 0)            AS expensive_output_tokens,
  COALESCE(SUM(SUM(cache_creation_tokens) FILTER (WHERE actual_family IN ('opus', 'fable')))
    OVER (PARTITION BY parent_family, path), 0)            AS expensive_cache_creation_tokens
FROM per_call
GROUP BY parent_family, path, actual_family
ORDER BY parent_family, path, spawns DESC;
