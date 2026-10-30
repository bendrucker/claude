-- ---
-- name: prune-acceptance
-- summary: >-
--   Per-class acceptance of prompting-audit proposals, per run and across the last two runs,
--   for the retire-a-class rule.
-- description: >-
--   Reads `prompting-audit.verdict` events from `mod_events`, one per proposal per round (a
--   round is one `run`), deduped by (`run`, `id`) keeping the latest. Proposals count from
--   verdicts, so a proposal with no verdict yet is not counted.
--
--   `scope` is `run` for one row per (`class`, `run`), or `last-2` for one row per `class`
--   across the two most recent runs by latest verdict time (`run` is NULL there). A class is
--   retired when `acceptance_rate` is below 0.5 in each of two consecutive `run` rows where
--   `proposals` is at least 5. `after_date` filters on event time before runs are ranked.
-- params:
--   - after_date
-- ---
WITH verdicts AS (
  SELECT
    (attributes->>'run') AS run,
    (attributes->>'id') AS id,
    (attributes->>'class') AS class,
    COALESCE(TRY_CAST((attributes->>'accepted') AS BOOLEAN), false) AS accepted,
    ts
  FROM mod_events
  WHERE event_name = 'prompting-audit.verdict'
    AND date_filter(ts, getvariable('after_date'), NULL)
),
latest AS (
  SELECT *
  FROM verdicts
  QUALIFY ROW_NUMBER() OVER (PARTITION BY run, id ORDER BY ts DESC) = 1
),
recent AS (
  SELECT run
  FROM latest
  GROUP BY run
  ORDER BY MAX(ts) DESC
  LIMIT 2
),
per_run AS (
  SELECT
    'run' AS scope,
    class,
    run,
    COUNT(*) AS proposals,
    COUNT(*) FILTER (WHERE accepted) AS accepted,
    MAX(ts) AS last_verdict
  FROM latest
  GROUP BY class, run
),
last_two AS (
  SELECT
    'last-2' AS scope,
    class,
    NULL AS run,
    COUNT(*) AS proposals,
    COUNT(*) FILTER (WHERE accepted) AS accepted,
    MAX(ts) AS last_verdict
  FROM latest
  WHERE run IN (SELECT run FROM recent)
  GROUP BY class
)
SELECT
  scope,
  class,
  run,
  proposals,
  accepted,
  round(accepted / proposals, 3) AS acceptance_rate,
  last_verdict
FROM (SELECT * FROM per_run UNION ALL SELECT * FROM last_two)
ORDER BY scope DESC, class, last_verdict DESC;
