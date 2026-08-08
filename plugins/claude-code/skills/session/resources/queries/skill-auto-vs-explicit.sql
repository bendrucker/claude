-- Per skill, how invocations split between the model choosing it, another skill chaining
-- into it, and the user typing its slash command. A skill the user always types can go
-- `disable-model-invocation` and stop paying for its always-on description; one the model
-- reaches for on its own is earning that description. The core skill-economy lever.
--
-- The three columns come from two different places, because a typed slash command is not
-- a Skill tool call. The harness expands `/name` into a user message carrying
-- `<command-name>/name</command-name>`, and no Skill tool_use follows: across the corpus
-- fewer than 1% of Skill calls have a matching slash command anywhere earlier in the
-- session. So `explicit` is counted from those markers in `raw`, and `model_auto` +
-- `chained` from `skill_calls`. Reading explicitness off the Skill call alone cannot work,
-- which is what the previous definition (`args IS NULL` means model-auto) got wrong:
-- passing args is ordinary model routing, so every parameterized skill read as 100%
-- explicit and its description looked unearned.
--
-- `chained` is a Skill call made while another skill held attribution, i.e. skill-to-skill
-- delegation rather than a fresh routing decision. It counts toward the description
-- earning its keep only if the calling skill names it by description rather than by name.
--
-- Blind spot: the skill universe here is whatever appears in `skill_calls`, so a skill the
-- user only ever types and the model never loads has no row at all. `skill-config-vs-
-- observed` reads the installed skills off disk and is the surface for that question.
-- Marker names are matched to a skill by full name (`plugin:skill`) or, for an unnamespaced
-- command, by the segment after the colon; two plugins exposing the same trailing name
-- would collapse into one row.
--
-- Params: after_date, before_date, project, host, min_calls (floor on total, default 1).
WITH scoped_sessions AS (
  SELECT host, session_id
  FROM sessions
  WHERE date_filter(start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(project_path, getvariable('project'))
    AND host_filter(host, getvariable('host'))
),
calls AS (
  SELECT
    sc.skill_name,
    tc.attribution_skill
  FROM skill_calls sc
  JOIN scoped_sessions USING (host, session_id)
  LEFT JOIN tool_calls tc ON tc.host = sc.host AND tc.tool_id = sc.tool_id
),
call_agg AS (
  SELECT
    skill_name,
    COUNT(*) FILTER (WHERE attribution_skill IS NULL)     AS model_auto,
    COUNT(*) FILTER (WHERE attribution_skill IS NOT NULL) AS chained
  FROM calls
  GROUP BY skill_name
),
-- The marker is emitted verbatim into the user message, so it is matched against the raw
-- JSON text rather than a pinned column. The length bound keeps a runaway match from
-- swallowing the rest of the line.
markers AS (
  SELECT ltrim(regexp_extract(r.data::VARCHAR, '<command-name>/?([^<]{1,60})</command-name>', 1), '/') AS command
  FROM raw r
  JOIN scoped_sessions USING (host, session_id)
  WHERE r.data::VARCHAR LIKE '%<command-name>%'
),
explicit_agg AS (
  SELECT ca.skill_name, COUNT(*) AS explicit
  FROM markers m
  JOIN call_agg ca
    ON m.command = ca.skill_name
    -- Both sides must be non-empty: split_part returns '' for an unnamespaced skill
    -- name, and an unparsed marker yields '', so without the guard every such skill
    -- absorbs every such marker.
   OR (m.command <> ''
       AND position(':' IN m.command) = 0
       AND m.command = NULLIF(split_part(ca.skill_name, ':', 2), ''))
  GROUP BY ca.skill_name
)
SELECT
  ca.skill_name,
  ca.model_auto,
  ca.chained,
  COALESCE(ea.explicit, 0) AS explicit,
  ca.model_auto + ca.chained + COALESCE(ea.explicit, 0) AS total
FROM call_agg ca
LEFT JOIN explicit_agg ea USING (skill_name)
WHERE ca.model_auto + ca.chained + COALESCE(ea.explicit, 0)
      >= COALESCE(getvariable('min_calls'), 1)
ORDER BY total DESC, ca.skill_name;
