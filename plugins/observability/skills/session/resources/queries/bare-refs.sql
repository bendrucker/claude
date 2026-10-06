-- ---
-- name: bare-refs
-- tier: 1
-- summary: >-
--   How often main-thread assistant prose cites a PR, issue, or ticket as a bare ID
--   (`#N`, `repo#N`, `!N`, `ENG-123`) instead of a markdown link or URL.
-- description: >-
--   Reads `text_content.text`, which already drops fenced and inline code, and keeps
--   assistant rows outside subagents, so tool inputs and bodies written through `gh`
--   never count. A ref inside `[...](url)` or a bare forge or tracker URL counts as
--   linked. Markdown links and URLs are stripped before the bare patterns run, so a
--   linked ref never also counts as bare. A single-digit `#N` or `!N` counts only after
--   "PR", "issue", or "MR", because unqualified it is almost always a list or finding
--   number. Tracker keys are uppercase letters, a hyphen, and digits, minus a denylist of
--   standards prefixes (`UTF-8`, `SHA-256`, `RFC-…`).
--
--   `bare_pct` is the share of ref-bearing messages with at least one bare ref, the
--   number to compare before and after a steering change. `per` picks the bucket:
--   `week` (default) or `model`.
-- params:
--   - name: per
--     default: week
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH scoped AS (
  SELECT
    host,
    session_id,
    source_file,
    source_line,
    MIN(timestamp) AS timestamp,
    ANY_VALUE(model) AS model,
    string_agg(text, chr(10)) AS text
  FROM text_content
  WHERE role = 'assistant'
    AND NOT is_subagent
    AND NOT is_system
    AND date_filter(timestamp, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(project_path, getvariable('project'))
    AND host_filter(host, getvariable('host'))
  GROUP BY host, session_id, source_file, source_line
),
delinked AS (
  SELECT
    *,
    regexp_extract_all(text, '\[[^\]\n]*\]\((https?://[^)\s]+)(?:\s+"[^"\n]*")?\)', 1) AS md_urls,
    regexp_replace(text, '\[[^\]\n]*\]\([^)\s]+(?:\s+"[^"\n]*")?\)', ' ', 'g') AS without_md
  FROM scoped
),
unlinked AS (
  SELECT
    *,
    md_urls || regexp_extract_all(without_md, 'https?://[^\s)>\]]+') AS urls,
    regexp_replace(without_md, 'https?://[^\s)>\]]+', ' ', 'g') AS prose
  FROM delinked
),
extracted AS (
  SELECT
    *,
    len(list_filter(
      urls,
      lambda u: regexp_matches(u, '/(pull|issues|merge_requests)/\d+|linear\.app/[^/]+/issue/|/browse/[A-Z]+-\d+')
    )) AS linked,
    list_filter(
      regexp_extract_all(prose, '(?:^|[^\w/&#!])((?:[\w.-]+/)?[\w.-]*#\d{1,6})\b', 1),
      lambda r: NOT regexp_matches(r, '^#\d$')
    )
      || regexp_extract_all(prose, '(?i)\b(?:PRs?|pull requests?|issues?|MRs?)\s+(#\d)\b', 1)
      || list_filter(
        regexp_extract_all(prose, '(?:^|[^\w/&#!])((?:[\w.-]+/)?[\w.-]*!\d{1,6})\b', 1),
        lambda r: NOT regexp_matches(r, '^!\d$')
      )
      || regexp_extract_all(prose, '\bMRs?\s+(!\d)\b', 1)
      || list_filter(
        regexp_extract_all(prose, '\b([A-Z]{2,10}-\d{1,6})\b', 1),
        lambda r: NOT regexp_matches(r, '^(UTF|SHA|ISO|CVE|CWE|GPT|RFC|TLS|SSL|HTTP|AES|RSA|PEP|UTC|MR|PR|ES|MD|OS|CP|WIN|COVID|FIND)-')
      ) AS bare
  FROM unlinked
),
refs AS (
  SELECT
    *,
    CASE COALESCE(getvariable('per'), 'week')
      WHEN 'model' THEN COALESCE(model, '(unknown)')
      ELSE strftime(date_trunc('week', timestamp), '%Y-%m-%d')
    END AS bucket
  FROM extracted
  WHERE linked > 0 OR len(bare) > 0
)
SELECT
  bucket,
  COUNT(*) AS ref_messages,
  COUNT(*) FILTER (WHERE len(bare) > 0) AS bare_messages,
  COUNT(*) FILTER (WHERE linked > 0) AS linked_messages,
  ROUND(100.0 * COUNT(*) FILTER (WHERE len(bare) > 0) / COUNT(*), 1) AS bare_pct,
  COUNT(DISTINCT (host, session_id)) AS sessions
FROM refs
GROUP BY bucket
ORDER BY bucket;
