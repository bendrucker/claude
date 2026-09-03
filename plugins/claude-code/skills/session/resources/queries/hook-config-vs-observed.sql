-- ---
-- name: hook-config-vs-observed
-- tier: 1
-- dimensions: [hook-coverage]
-- summary: >-
--   Hooks configured on disk but never observed firing in the index, left-joined so the
--   `observed_fires = 0` rows surface.
-- description: >-
--   `hooks`, `hook-blocks`, and `stop-hook-noop-detector` all start from `hook_events`,
--   which only gets a row when a hook produces stdout, a decision, or a non-zero exit. A
--   hook that silently exits 0 on every invocation (an env-var guard gone stale, a broken
--   path) leaves no row at all, so those queries are blind to it: they mine what fired,
--   never what should have fired. This one starts from disk config instead.
--
--   The configured side reads local disk, not the index: plugin `hooks.json` under the
--   plugin cache (content is duplicated across version-hash directories, so it is pinned to
--   one hash per plugin, picking arbitrarily since the copies are byte-identical for the
--   installed version), `~/.claude/settings.json`, and `.claude/settings.json` relative to
--   the invoking cwd. Both settings paths are fixed rather than globbed, so point duckdb's
--   cwd at the project you want scoped, and a missing file at a fixed path errors rather
--   than returning zero rows.
--
--   Matching a configured command to `hook_events.command` is heuristic: either side may
--   have `${CLAUDE_PLUGIN_ROOT}` or `$CLAUDE_PROJECT_DIR` expanded, and observed strings can
--   carry a wrapping interpreter or trailing args. `match_key` resolves, in order: the
--   basename of the last path segment ending in a known script extension, else the last
--   slash-delimited segment when the command's final token is a bare path, else the trimmed
--   command text verbatim. Two plugins' scripts sharing a basename collapse into one row,
--   and a configured command with no extension, no bare trailing path, and a verbatim
--   mismatch against its observed form reports as unobserved when it actually ran.
--
--   A 0 in `observed_fires` is a lead, not proof of breakage: a conditional injector that
--   legitimately produces no output on most events looks identical here to a hook that
--   never runs at all. Read the script before treating a 0 as a bug.
-- params:
--   - name: hook
--     meaning: GLOB on configured command
--   - name: hook_config_glob
--     default: '~/.claude/plugins/cache/*/*/*/hooks/hooks.json'
--     meaning: the plugin-cache glob
--   - after_date
--   - before_date
--   - project
--   - name: host
--     meaning: >-
--       scopes the observed side only, since the configured side always reflects this
--       machine's disk, so pass `local` when grounding a finding
-- ---
WITH raw_configs AS (
  SELECT
    'plugin:' || regexp_extract(filename, 'cache/([^/]+)/([^/]+)/([^/]+)/hooks/hooks\.json$', 1)
      || '/' || regexp_extract(filename, 'cache/([^/]+)/([^/]+)/([^/]+)/hooks/hooks\.json$', 2) AS source,
    regexp_extract(filename, 'cache/([^/]+)/([^/]+)/([^/]+)/hooks/hooks\.json$', 3) AS hash,
    json AS data
  FROM read_json_objects(
    COALESCE(TRY_CAST(getvariable('hook_config_glob') AS VARCHAR), '~/.claude/plugins/cache/*/*/*/hooks/hooks.json'),
    filename := true
  )
  QUALIFY row_number() OVER (PARTITION BY source ORDER BY hash) = 1

  UNION ALL

  SELECT 'user:settings.json' AS source, NULL AS hash, json AS data
  FROM read_json_objects('~/.claude/settings.json', filename := true)

  UNION ALL

  SELECT 'project:.claude/settings.json' AS source, NULL AS hash, json AS data
  FROM read_json_objects('.claude/settings.json', filename := true)
),
events AS (
  SELECT source, data, unnest(json_keys(data, '$.hooks')) AS event
  FROM raw_configs
),
groups AS (
  SELECT source, event, unnest(json_extract(data, '$.hooks.' || event)::JSON[]) AS grp
  FROM events
),
configured AS (
  SELECT DISTINCT
    source,
    event,
    json_extract_string(entry, '$.command') AS command
  FROM groups, unnest(json_extract(grp, '$.hooks')::JSON[]) AS t(entry)
  WHERE json_extract_string(entry, '$.type') = 'command'
),
keyed_configured AS (
  SELECT
    source,
    event,
    command,
    COALESCE(
      NULLIF(regexp_extract(command, '([A-Za-z0-9_.-]+\.(?:sh|ts|js|mjs|cjs|py|rb))', 1), ''),
      NULLIF(reverse(regexp_extract(reverse(rtrim(trim(command), chr(34) || chr(39))), '^([^/[:space:]]+)/', 1)), ''),
      trim(command)
    ) AS match_key
  FROM configured
  WHERE getvariable('hook') IS NULL OR command GLOB getvariable('hook')::VARCHAR
),
ev AS (
  SELECT he.host, he.hook_event, COALESCE(he.command, he.hook_name) AS command, he.timestamp
  FROM hook_events he
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
),
keyed_observed AS (
  SELECT
    hook_event,
    COALESCE(
      NULLIF(regexp_extract(command, '([A-Za-z0-9_.-]+\.(?:sh|ts|js|mjs|cjs|py|rb))', 1), ''),
      NULLIF(reverse(regexp_extract(reverse(rtrim(trim(command), chr(34) || chr(39))), '^([^/[:space:]]+)/', 1)), ''),
      trim(command)
    ) AS match_key,
    timestamp
  FROM ev
),
observed_agg AS (
  SELECT
    hook_event,
    match_key,
    COUNT(*) AS observed_fires,
    MIN(timestamp) AS first_observed,
    MAX(timestamp) AS last_observed
  FROM keyed_observed
  GROUP BY hook_event, match_key
)
SELECT
  kc.source AS config_source,
  kc.event,
  kc.command,
  COALESCE(oa.observed_fires, 0) AS observed_fires,
  oa.first_observed,
  oa.last_observed
FROM keyed_configured kc
LEFT JOIN observed_agg oa
  ON oa.hook_event = kc.event
 AND oa.match_key = kc.match_key
ORDER BY observed_fires ASC, kc.source, kc.event;
