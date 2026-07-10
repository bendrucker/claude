-- Skills that are CONFIGURED on disk but rarely or never OBSERVED in skill_calls.
-- skills.sql counts what fired; it never sees a skill that is installed but silent,
-- even though every model-invocable skill pays its description into context on every
-- session (the curation doctrine's always-on cost). This query starts from SKILL.md
-- frontmatter on disk instead, the same configured-vs-observed shape as
-- hook-config-vs-observed.sql. Requires the yaml community extension: run with
-- `-init resources/extensions.sql`.
--
-- Configured side, read from local disk (not the index):
--   1. Plugin skills under the plugin cache. Content is duplicated across
--      version-hash directories for the same plugin (the duplication frontmatter.sql
--      documents); pinned to one hash per (marketplace, plugin, skill) via QUALIFY,
--      picking arbitrarily since the copies are byte-identical for the installed
--      version.
--   2. ~/.claude/skills (personal skills, invoked by bare name).
--   3. .claude/skills relative to the invoking cwd (project skills, bare name):
--      point duckdb's cwd at the project you want scoped before running.
-- A glob with no matching files errors rather than returning zero rows (the same
-- DuckDB reader limitation hook-config-vs-observed.sql documents); override the
-- glob for an absent source.
--
-- Matching a configured skill to skill_calls.skill_name: a plugin skill's
-- invocation name is <plugin>:<skill-dir> derived from the cache path (frontmatter
-- `name` is often unnamespaced), and an entry skill (<p>:<p>) also matches bare
-- `<p>` calls, which appear in real data. Personal/project skills match their bare
-- dir name. False-match risk: a personal skill sharing a plugin's name absorbs its
-- bare calls. Built-in CLI skills (code-review, verify, ...) have no SKILL.md under
-- these globs, so they never appear here.
--
-- disable_model_invocation matters for reading a 0: those skills load no
-- description into context and only fire via explicit /slash use, so a zero for
-- them is normal. description_chars approximates the always-on cost of every
-- other row. Treat a 0 in calls as a lead to investigate: the observed side only
-- spans the index, and a newly added skill has no history.
--
-- Params: after_date, before_date, project, host (all scope the OBSERVED side
-- only; the configured side always reflects this machine's current disk state, so
-- pass host='local' when grounding a finding rather than trusting another host's
-- call count), skill (GLOB on configured name), plugin_skill_glob /
-- user_skill_glob / project_skill_glob (override the three configured sources).
WITH plugin_files AS (
  SELECT
    regexp_extract(filename, 'cache/([^/]+)/([^/]+)/([^/]+)/skills/([^/]+)/SKILL\.md$', 1) AS marketplace,
    regexp_extract(filename, 'cache/([^/]+)/([^/]+)/([^/]+)/skills/([^/]+)/SKILL\.md$', 2) AS plugin,
    regexp_extract(filename, 'cache/([^/]+)/([^/]+)/([^/]+)/skills/([^/]+)/SKILL\.md$', 3) AS hash,
    regexp_extract(filename, 'cache/([^/]+)/([^/]+)/([^/]+)/skills/([^/]+)/SKILL\.md$', 4) AS skill,
    frontmatter::VARCHAR AS fm
  FROM read_yaml_frontmatter(
    COALESCE(TRY_CAST(getvariable('plugin_skill_glob') AS VARCHAR), '~/.claude/plugins/cache/*/*/*/skills/*/SKILL.md'),
    as_yaml_objects := true, filename := true)
  QUALIFY row_number() OVER (PARTITION BY marketplace, plugin, skill ORDER BY hash) = 1
),
configured AS (
  SELECT
    'plugin:' || marketplace || '/' || plugin AS source,
    plugin || ':' || skill AS skill_name,
    CASE WHEN plugin = skill
      THEN [plugin || ':' || skill, skill]
      ELSE [plugin || ':' || skill]
    END AS match_keys,
    fm
  FROM plugin_files

  UNION ALL

  SELECT
    'user:~/.claude/skills' AS source,
    regexp_extract(filename, '([^/]+)/SKILL\.md$', 1) AS skill_name,
    [regexp_extract(filename, '([^/]+)/SKILL\.md$', 1)] AS match_keys,
    frontmatter::VARCHAR AS fm
  FROM read_yaml_frontmatter(
    COALESCE(TRY_CAST(getvariable('user_skill_glob') AS VARCHAR), '~/.claude/skills/*/SKILL.md'),
    as_yaml_objects := true, filename := true)

  UNION ALL

  SELECT
    'project:.claude/skills' AS source,
    regexp_extract(filename, '([^/]+)/SKILL\.md$', 1) AS skill_name,
    [regexp_extract(filename, '([^/]+)/SKILL\.md$', 1)] AS match_keys,
    frontmatter::VARCHAR AS fm
  FROM read_yaml_frontmatter(
    COALESCE(TRY_CAST(getvariable('project_skill_glob') AS VARCHAR), '.claude/skills/*/SKILL.md'),
    as_yaml_objects := true, filename := true)
),
keyed AS (
  SELECT
    source,
    skill_name,
    length(yaml_extract_string(fm, '$.description')) AS description_chars,
    COALESCE(TRY_CAST(yaml_extract_string(fm, '$."disable-model-invocation"') AS BOOLEAN), false) AS disable_model_invocation,
    unnest(match_keys) AS match_key
  FROM configured
  WHERE getvariable('skill') IS NULL OR skill_name GLOB getvariable('skill')::VARCHAR
),
observed AS (
  SELECT sc.skill_name, sc.host, sc.session_id, sc.timestamp
  FROM skill_calls sc
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
)
SELECT
  k.source,
  k.skill_name,
  k.description_chars,
  k.disable_model_invocation,
  COUNT(o.skill_name) AS calls,
  -- FILTER guards the unmatched LEFT JOIN row: a (NULL, NULL) struct is not NULL,
  -- so a bare COUNT(DISTINCT ...) would report 1 session for a zero-fire skill.
  COUNT(DISTINCT (o.host, o.session_id)) FILTER (o.session_id IS NOT NULL) AS sessions,
  MAX(o.timestamp) AS last_seen
FROM keyed k
LEFT JOIN observed o ON o.skill_name = k.match_key
GROUP BY k.source, k.skill_name, k.description_chars, k.disable_model_invocation
ORDER BY calls ASC, k.source, k.skill_name;
