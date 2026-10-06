-- ---
-- name: catalog-reinjection-thrash-sessions
-- tier: 2
-- dimensions: [context-tax]
-- summary: >-
--   Sessions re-injecting the full skill catalog and deferred-tools delta, cumulatively
--   re-billing the same context.
-- description: >-
--   Counts `skill_listing` and `deferred_tools_delta` injections per session with an
--   estimated token total, split into `main_injections`/`main_ktokens` and
--   `sidechain_injections`/`sidechain_ktokens`. The catalog is injected once into the main
--   thread and once per subagent context, so the two halves mean different things:
--   `main_injections` above 1 (outside compaction) is re-injection thrash, while
--   `sidechain_injections` is the per-subagent cost of fan-out and scales with subagent
--   count rather than with any harness defect. Rank on `main_injections` for defects and
--   on `sidechain_ktokens` for fan-out spend.
-- params:
--   - name: min_injections
--     default: 6
--     meaning: floor on a session's injection count
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH att AS (
  SELECT
    a.host,
    a.session_id,
    a.project_path,
    a.kind,
    a.attachment,
    a.is_sidechain
  FROM attachments a
  JOIN sessions s USING (host, session_id)
  WHERE a.kind IN ('skill_listing', 'deferred_tools_delta')
    AND date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
),
per AS (
  SELECT
    host,
    session_id,
    regexp_extract(project_path, '[^/]+$')                  AS repo,
    COUNT(*) FILTER (WHERE kind = 'skill_listing')          AS skill_listings,
    COUNT(*) FILTER (WHERE kind = 'deferred_tools_delta')   AS tool_deltas,
    COUNT(*) FILTER (WHERE NOT is_sidechain)                AS main_injections,
    COUNT(*) FILTER (WHERE is_sidechain)                    AS sidechain_injections,
    SUM(length(attachment::VARCHAR)) FILTER (WHERE NOT is_sidechain) AS main_chars,
    SUM(length(attachment::VARCHAR)) FILTER (WHERE is_sidechain)     AS sidechain_chars,
    SUM(length(attachment::VARCHAR))                        AS chars
  FROM att
  GROUP BY host, session_id, project_path
)
SELECT
  host,
  session_id,
  repo,
  main_injections,
  sidechain_injections,
  skill_listings,
  tool_deltas,
  ROUND(COALESCE(main_chars, 0) / 4.0 / 1000.0)      AS main_ktokens,
  ROUND(COALESCE(sidechain_chars, 0) / 4.0 / 1000.0) AS sidechain_ktokens,
  ROUND(chars / 4.0 / 1000.0)                        AS est_ktokens
FROM per
WHERE skill_listings + tool_deltas > COALESCE(getvariable('min_injections'), 6)
ORDER BY est_ktokens DESC
LIMIT 20;
