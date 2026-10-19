-- ---
-- name: sandbox-bypass-effective-command
-- dimensions: [permissions-sandbox]
-- summary: >-
--   Bypassed commands by their real verb, ranked by frequency, with the split between
--   bypasses that followed a failed sandboxed run (`justified`) and those that did not
--   (`reflexive`): the `excludedCommands` candidates.
-- description: >-
--   The verb is `sandbox_bypasses.verb`, the command with `cd`/`echo` wrappers and env
--   assignments stripped, so compound commands surface the tool that needs the exemption.
--   The operating rule is to bypass only after a sandboxed run of that command failed, so
--   `justified_pct` measures adherence per verb and, in the `(all)` rollup row per host
--   (sorted first, covering verbs under `min_count`), across the corpus.
--
--   A low percentage does not establish that the sandbox would have worked. The back-link
--   requires a prior failure of the byte-identical command by the same agent in the same
--   session, so a failure learned elsewhere or from a command differing by a path leaves no
--   trace. Read a low-percentage verb as an `excludedCommands` candidate or a reflex.
-- params:
--   - name: min_count
--     default: 5
--     meaning: floor on a verb's total
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH grouped AS (
  SELECT
    sb.host,
    CASE WHEN GROUPING(sb.verb) = 1 THEN '(all)' ELSE sb.verb END AS cmd,
    GROUPING(sb.verb) AS is_rollup,
    COUNT(*)                                               AS bypasses,
    COUNT(*) FILTER (WHERE sb.retried_tool_id IS NOT NULL) AS justified,
    COUNT(*) FILTER (WHERE sb.retried_tool_id IS NULL)     AS reflexive,
    COUNT(DISTINCT sb.session_id)                          AS sessions
  FROM sandbox_bypasses sb
  JOIN scoped_sessions() s USING (host, session_id)
  WHERE sb.verb IS NOT NULL
  GROUP BY GROUPING SETS ((sb.host), (sb.host, sb.verb))
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
