-- ---
-- name: sandbox-bypass-effective-command
-- tier: 1
-- dimensions: [permissions-sandbox]
-- summary: >-
--   Bypassed commands normalized to their real verb, ranked by frequency: the
--   `excludedCommands` candidates.
-- description: >-
--   Normalization strips leading preamble from a `dangerouslyDisableSandbox` command,
--   `cd <path>` wrappers, `echo` lines, and `VAR=value` env assignments (optionally
--   exported, each followed by `&&`, a semicolon, a newline, or whitespace for
--   assignments), so the tool that actually needs the bypass surfaces. The normalization is
--   the reusable part, because it recurs across every permission and sandbox question:
--   compound commands otherwise hide the verb that needs an exemption.
-- params:
--   - name: min_count
--     default: 5
--     meaning: floor on a command's total
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH stripped AS (
  SELECT
    sb.host,
    sb.session_id,
    -- Strip repeated prefixes off the front, one per repetition, leaving the command.
    regexp_replace(
      trim(sb.command),
      '^('
        || '(cd [^&;\n]*|echo [^&;\n]*)(&&|;|\n)\s*'     -- a `cd ~/src &&` or `echo hi;` wrapper
        || '|'                                           -- or
        || '(export )?[A-Za-z_][A-Za-z0-9_]*='           -- an env assignment, optionally exported
        || '(\$\([^)]*\)|"[^"]*"|''[^'']*''|[^\s;&|]*)'  -- whose value is `$(...)`, quoted, or bare
        || '\s*(&&|;)?\s*'                               -- and whose trailing `&&` or `;` is optional
      || ')+',
      ''
    ) AS eff
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
