-- Ranks the window's `ask` verdicts by tool, normalized reason, and Bash verb.
-- `compound` marks a Bash command chained, piped, or substituted, which no prefix
-- allow rule matches. Interactive tools wait on the person and are left out.
-- Params: after_date, before_date, host, limit.
WITH v AS (
  SELECT v.*, c.command
  FROM classifier_verdicts v
  LEFT JOIN tool_calls c ON c.host = v.host AND c.tool_id = v.tool_use_id
  WHERE v.decision = 'ask'
    AND NOT v.interactive
    AND date_filter(v.started_at, getvariable('after_date'), getvariable('before_date'))
    AND host_filter(v.host, getvariable('host'))
),
keyed AS (
  SELECT *,
    regexp_replace(
      regexp_replace(split_part(reason, ': ', 1), '(/[^\s,]+)+', '<path>', 'g'),
      '\s+', ' ', 'g') AS reason_key,
    regexp_replace(trim(command), '^cd \S+ (&&|;) ', '') AS bare
  FROM v
)
SELECT
  tool,
  reason_key,
  CASE WHEN tool = 'Bash' THEN split_part(bare, ' ', 1) END AS verb,
  CASE WHEN tool = 'Bash' THEN regexp_matches(bare, '[|;&\n]|\$\(|<<') END AS compound,
  COUNT(*) AS asks,
  COUNT(DISTINCT session_id) AS sessions,
  list(DISTINCT left(command, 160)) FILTER (WHERE command IS NOT NULL)[1:3] AS samples
FROM keyed
GROUP BY ALL
HAVING COUNT(DISTINCT session_id) > 1
ORDER BY asks DESC
LIMIT coalesce(getvariable('limit'), 40);
