-- Top commands that get dangerouslyDisableSandbox, normalized to their real verb by
-- stripping a leading `cd <path>` wrapper (followed by `&&`, `;`, or a newline) so the
-- actual tool (not `cd`) surfaces. The normalization is the reusable part: it recurs
-- across every permission and sandbox question, because compound commands otherwise hide
-- the verb that needs an exemption. Ranked by frequency; reveals `excludedCommands`
-- candidates.
-- Params: after_date, before_date, project, host, min_count (floor, default 5).
WITH stripped AS (
  SELECT
    sb.host,
    sb.session_id,
    regexp_replace(trim(sb.command), '^cd [^&;]*?(&&|;|\n)\s*', '') AS eff
  FROM sandbox_bypasses sb
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
)
SELECT
  host,
  regexp_extract(trim(eff), '^[A-Za-z0-9_./-]+', 0) AS cmd,
  COUNT(*)                   AS n,
  COUNT(DISTINCT session_id) AS sessions
FROM stripped
WHERE eff <> ''
GROUP BY host, cmd
HAVING COUNT(*) >= COALESCE(getvariable('min_count'), 5)
ORDER BY n DESC, host;
