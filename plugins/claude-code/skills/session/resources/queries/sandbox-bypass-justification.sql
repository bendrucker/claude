-- ---
-- name: sandbox-bypass-justification
-- tier: 1
-- summary: >-
--   Per normalized command verb, the split between bypasses that followed a failed
--   sandboxed run of the same command (`justified`) and bypasses with no such failure on
--   record (`reflexive`).
-- description: >-
--   The operating rule is to run sandboxed and bypass only after a sandboxed run of that
--   command actually failed, so `justified_pct` measures adherence per verb and, in the
--   `(all)` rollup row, across the whole corpus. The verb comes from the same normalization
--   `sandbox-bypass-effective-command` applies, so the two queries agree on what counts as
--   one command. Rows are per (host, verb) plus one `(all)` rollup per host, which sorts
--   first and covers every verb including those under `min_count`.
--
--   A low percentage does not establish that the sandbox would have worked. The back-link
--   requires a prior failure of the byte-identical command by the same agent in the same
--   session, so a failure learned in an earlier session, in another repo, or from a command
--   differing by a path leaves no trace. Read a low-percentage verb as a candidate for
--   `excludedCommands`, which removes the need to bypass at all, or as a prompt to check
--   whether the flag is reflex.
-- params:
--   - name: min_count
--     default: 5
--     meaning: floor on a verb's total
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH stripped AS (
  SELECT
    sb.host,
    sb.session_id,
    sb.retried_tool_id,
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
),
verbs AS (
  SELECT
    host,
    session_id,
    retried_tool_id,
    regexp_extract(trim(eff), '^[A-Za-z0-9_./-]+', 0) AS cmd
  FROM stripped
  WHERE eff <> ''
),
grouped AS (
  SELECT
    host,
    CASE WHEN GROUPING(cmd) = 1 THEN '(all)' ELSE cmd END AS cmd,
    GROUPING(cmd) AS is_rollup,
    COUNT(*)                                                AS bypasses,
    COUNT(*) FILTER (WHERE retried_tool_id IS NOT NULL)     AS justified,
    COUNT(*) FILTER (WHERE retried_tool_id IS NULL)         AS reflexive,
    COUNT(DISTINCT session_id)                              AS sessions
  FROM verbs
  GROUP BY GROUPING SETS ((host), (host, cmd))
)
SELECT
  host,
  cmd,
  bypasses,
  justified,
  reflexive,
  ROUND(100.0 * justified / bypasses, 1) AS justified_pct,
  sessions
FROM grouped
WHERE is_rollup = 1 OR bypasses >= COALESCE(getvariable('min_count'), 5)
ORDER BY host, is_rollup DESC, bypasses DESC, cmd;
