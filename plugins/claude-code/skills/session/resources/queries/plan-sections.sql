-- Plan structure: one row per markdown section across plan files on disk, joined to
-- the session that produced each plan. Reads plans with the `markdown` community
-- extension (load it via `-init resources/extensions.sql`). The glob self-defaults to
-- the local plans dir and accepts an optional `plans_glob` override.
--
-- Disk plans are local-host current state: a `plan_calls.plan_file` from another
-- machine (or a deleted plan) has no file on disk, so the LEFT JOIN leaves it out of
-- the section rows without affecting session-side data. Use embedded `$.input.plan`
-- (via plan_calls.plan_chars / content_items) for cross-host or point-in-time needs.
--
-- TODO(https://github.com/teaguesterling/duckdb_markdown/pull/20): we read sections
-- from disk because `md_extract_sections` is binder-ambiguous on VARCHAR input, so the
-- embedded `$.input.plan` text can't be sectioned in-memory. Once that fix is released,
-- `md_extract_sections` over `plan_calls`' embedded plan supersedes the disk read: it
-- works cross-host and point-in-time with no missing-file caveat. Revisit whether this
-- on-disk query is still worth keeping at that point.
--
-- Params: plans_glob (override the default plans dir).
-- Example: plans whose section titles never include "Verification".
WITH sections AS (
  SELECT
    file_path,
    level,
    title,
    md_to_text(content) AS content_text,
    start_line,
    end_line
  FROM read_markdown_sections(
    COALESCE(
      TRY_CAST(getvariable('plans_glob') AS VARCHAR),
      '~/.claude/plans/*.md'
    ),
    filename=true
  )
)
SELECT
  pc.session_id,
  pc.outcome,
  pc.plan_seq,
  s.file_path,
  s.level,
  s.title,
  s.end_line - s.start_line AS section_lines
FROM sections s
LEFT JOIN plan_calls pc ON pc.plan_file = s.file_path
ORDER BY s.file_path, s.start_line;
