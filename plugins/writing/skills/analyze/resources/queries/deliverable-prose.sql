WITH hook_excluded AS (
  SELECT unnest([
    '/.claude/projects/%/memory/%',
    '/.claude/plans/%',
    '%/wordlists/%.txt'
  ]) AS pattern
),

write_prose AS (
  SELECT
    ci.session_id,
    (ci.data->>'$.input.content') AS text
  FROM content_items ci
  JOIN sessions s USING (host, session_id)
  WHERE ci.type = 'tool_use'
    AND ci.name = 'Write'
    AND regexp_matches((ci.data->>'$.input.file_path'), '\.(md|txt|rst|adoc)$')
    AND NOT EXISTS (
      SELECT 1 FROM hook_excluded
      WHERE (ci.data->>'$.input.file_path') LIKE pattern
    )
    AND date_filter(ci.timestamp, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
),

edit_prose AS (
  SELECT
    ci.session_id,
    (ci.data->>'$.input.new_string') AS text
  FROM content_items ci
  JOIN sessions s USING (host, session_id)
  WHERE ci.type = 'tool_use'
    AND ci.name = 'Edit'
    AND regexp_matches((ci.data->>'$.input.file_path'), '\.(md|txt|rst|adoc)$')
    AND NOT EXISTS (
      SELECT 1 FROM hook_excluded
      WHERE (ci.data->>'$.input.file_path') LIKE pattern
    )
    AND date_filter(ci.timestamp, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
),

bash_prose AS (
  SELECT
    ci.session_id,
    COALESCE(
      NULLIF(regexp_extract((ci.data->>'$.input.command'), '<<''?\w+''?\n([\s\S]+)\n\w+', 1), ''),
      NULLIF(regexp_extract((ci.data->>'$.input.command'), '(?:-m|--(?:body|message|description|title))\s+"([^"]+)"', 1), ''),
      NULLIF(regexp_extract((ci.data->>'$.input.command'), '(?:-m|--(?:body|message|description|title))\s+''([^'']+)''', 1), '')
    ) AS text
  FROM content_items ci
  JOIN sessions s USING (host, session_id)
  WHERE ci.type = 'tool_use'
    AND ci.name = 'Bash'
    AND regexp_matches(
      (ci.data->>'$.input.command'),
      '(--(?:body|message|description|title)\s|git commit -m\s)'
    )
    AND NOT regexp_matches((ci.data->>'$.input.command'), '--body-file\s')
    AND date_filter(ci.timestamp, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
)

SELECT session_id, text
FROM write_prose
WHERE text IS NOT NULL AND length(trim(text)) >= 30

UNION ALL

SELECT session_id, text
FROM edit_prose
WHERE text IS NOT NULL AND length(trim(text)) >= 30

UNION ALL

SELECT session_id, text
FROM bash_prose
WHERE text IS NOT NULL AND length(trim(text)) >= 30;
