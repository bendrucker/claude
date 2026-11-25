-- ---
-- name: writing-bash-coverage
-- dimensions: [hook-coverage]
-- reads: disk
-- summary: >-
--   Per week, Bash calls that look like they write prose to a markdown file, against how many
--   have a writing-hook run-log row: the miss rate of the Bash lint path's detection.
-- description: >-
--   The writing plugin lints files a Bash call changed and logs one row per file, with
--   `tool: "Bash"`, to `~/.claude/writing-hooks/log.jsonl`. This query estimates how many
--   Bash calls that write prose that path never saw. Candidates are `tool_calls` whose
--   `command` matches a python heredoc opening a `.md` path for writing, `sed -i` or
--   `perl -pi` on `.md`, `tee` into `.md`, or a `>` or `>>` redirect into `.md`, minus any
--   command naming `/tmp`, `$TMPDIR`, or a `tmp/` segment. Joining on `session_id` and
--   `tool_id` to the log's Bash rows gives `logged`, and `miss_pct` is the rest.
--
--   The match is loose on purpose and for estimation only. It reads the whole command, so a
--   command that merely mentions a `.md` path beside a redirect to something else counts as a
--   candidate, and a write the regexes miss never appears. Treat `miss_pct` as a trend, and
--   read sample `command` values before acting on a level.
--
--   The run log only covers calls after the Bash path shipped, so candidates are limited to
--   timestamps on or after the first Bash row in the log, and the query returns no rows
--   while the log holds none. The log is read from this machine's disk and carries no host
--   column, so pass `host` as `local` to match it, and a rotated `.1` file is not read. With
--   no log file DuckDB raises an IO Error naming the path rather than returning no rows.
-- params:
--   - name: log_path
--     default: '~/.claude/writing-hooks/log.jsonl'
--     meaning: the writing-hooks run log
--   - after_date
--   - before_date
--   - project
--   - name: host
--     meaning: >-
--       scopes the candidate side only, since the log always reflects this machine's disk, so
--       pass `local` when grounding a finding
-- ---
WITH log AS (
  SELECT
    session_id,
    tool_use_id,
    tool,
    TRY_CAST(ts AS TIMESTAMPTZ) AS ts
  FROM read_json_auto(
    COALESCE(TRY_CAST(getvariable('log_path') AS VARCHAR), '~/.claude/writing-hooks/log.jsonl'),
    union_by_name = true
  )
  WHERE tool = 'Bash' AND event = 'PostToolUse'
),
first_bash AS (
  SELECT MIN(ts) AS ts FROM log
),
logged AS (
  SELECT DISTINCT session_id, tool_use_id FROM log
),
candidates AS (
  SELECT
    tc.host,
    tc.session_id,
    tc.tool_id,
    CAST(tc.timestamp AS TIMESTAMPTZ) AS ts
  FROM tool_calls tc
  JOIN scoped_sessions() s USING (host, session_id)
  WHERE tc.tool_name = 'Bash'
    AND tc.command IS NOT NULL
    AND (
      (regexp_matches(tc.command, 'python3?\b')
        AND regexp_matches(tc.command, '\.md\b')
        AND regexp_matches(tc.command, 'open\([^)]*,\s*[''"][wa]|write_text|\.write\('))
      OR (regexp_matches(tc.command, '\b(sed\s+-[A-Za-z]*i|perl\s+-[A-Za-z]*i)')
        AND regexp_matches(tc.command, '\.md\b'))
      OR regexp_matches(tc.command, '\btee\s+(-a\s+)?\S*\.md\b')
      OR regexp_matches(tc.command, '>>?\s*\S*\.md\b')
    )
    AND NOT regexp_matches(tc.command, '/tmp(/|\b)|\$\{?TMPDIR|(^|[^A-Za-z0-9_.-])tmp/')
)
SELECT
  date_trunc('week', c.ts)::DATE                        AS week,
  COUNT(*)                                              AS candidates,
  COUNT(*) FILTER (WHERE l.session_id IS NOT NULL)      AS logged,
  ROUND(100.0 * COUNT(*) FILTER (WHERE l.session_id IS NULL) / COUNT(*), 1) AS miss_pct
FROM candidates c
CROSS JOIN first_bash fb
LEFT JOIN logged l ON l.session_id = c.session_id AND l.tool_use_id = c.tool_id
WHERE c.ts >= fb.ts
GROUP BY week
ORDER BY week;
