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
