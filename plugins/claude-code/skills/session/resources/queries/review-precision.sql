-- ---
-- name: review-precision
-- tier: 1
-- summary: >-
--   Per-angle precision for the code-review pipeline, one row per angle plus one per
--   (angle, effort level), with the `level = 'all'` rollup first.
-- description: >-
--   Which finder angles produce findings that survive verification and get applied, and
--   which burn a finder spawn, a verifier spawn, and a slot under the output cap to produce
--   something nobody acts on.
--
--   An angle is identified by the finding's `category` slug, which `review:code` defines as
--   a short kebab-case slug for the angle that produced it. That is the orchestrator's
--   self-report rather than a spawn-side join: the `review:angle` spawns carry free-form
--   descriptions that do not map onto slugs, and one spawn can feed several categories. The
--   canonical slugs (correctness, simplification, efficiency, reuse, altitude, conventions)
--   are the angle names verbatim and are trustworthy, while ad-hoc ones like
--   `test-coverage` or `documentation` are a finer label the model invented and land in
--   their own rows rather than under the angle that produced them.
--
--   `confirmed_pct` is the share of verdicted findings the verifier could pin to a trigger,
--   so a low share with a high `plausible` count is an angle generating mechanisms nobody
--   can construct a failure for. `no_change` is the author finding it wrong or already
--   handled while applying, a post-hoc refutation and the strongest false-positive evidence
--   available here. `skipped` is real but not applied, the earn-its-spawn number for a
--   cleanup angle. `acted_pct` is fixed as a share of everything resolved, NULL when no
--   `--fix` pass ran rather than a fabricated zero. `refuted` is near-zero by construction,
--   because the pipeline drops REFUTED candidates before reporting and the verifier's
--   verdict survives only as free-form prose in its subagent transcript.
--
--   Findings are deduped per session and identity, because a `--fix` run re-reports the
--   same findings with outcomes attached and counting the calls would inflate every column
--   and weight re-reported findings highest.
-- params:
--   - name: skill
--     meaning: >-
--       glob on the calling skill, where unset spans every caller including user-typed
--       /code-review, which carries no skill attribution
--   - name: min_findings
--     default: 1
--     meaning: floor on an angle's rollup total
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
-- The query exists to change `plugins/review/skills/code/angles.md`: narrow an angle whose
-- findings nobody acts on, or widen one that only ever confirms. Delete it and its catalog
-- header once two readings a month apart both leave that file untouched, whether because
-- the spreads sit inside noise or because the answer is already known. `git log` on
-- `angles.md` is where that evidence surfaces.
WITH reports AS (
  SELECT
    ci.host,
    ci.session_id,
    ci.timestamp,
    (ci.data->>'$.input.level') AS level,
    unnest(CAST(json_extract(ci.data, '$.input.findings') AS JSON[])) AS finding
  FROM content_items ci
  JOIN sessions s USING (host, session_id)
  WHERE ci.type = 'tool_use'
    AND ci.name = 'ReportFindings'
    AND (getvariable('skill') IS NULL OR ci.attribution_skill ILIKE getvariable('skill')::VARCHAR)
    AND date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
),
findings AS (
  SELECT
    host,
    session_id,
    timestamp,
    level,
    (finding->>'category') AS category,
    upper(finding->>'verdict') AS verdict,
    (finding->>'outcome') AS outcome,
    -- file:line alone collides when one line draws two findings, so the summary joins the
    -- key. short_summary is the stable form; pre-short_summary reports fall back to summary.
    (finding->>'file') || ':' || (finding->>'line') || '|'
      || COALESCE(finding->>'short_summary', finding->>'summary') AS finding_key
  FROM reports
),
-- The last report of a finding is the authoritative one: it carries the outcome the
-- earlier reports were made before knowing.
deduped AS (
  SELECT
    host,
    session_id,
    finding_key,
    arg_max(category, timestamp) AS category,
    arg_max(level, timestamp) AS level,
    arg_max(verdict, timestamp) FILTER (WHERE verdict IS NOT NULL) AS verdict,
    arg_max(outcome, timestamp) FILTER (WHERE outcome IS NOT NULL) AS outcome
  FROM findings
  GROUP BY 1, 2, 3
),
grouped AS (
  SELECT
    COALESCE(category, '(uncategorized)') AS category,
    CASE WHEN GROUPING(level) = 1 THEN 'all' ELSE COALESCE(level, '(none)') END AS level,
    GROUPING(level) AS is_rollup,
    COUNT(*) AS findings,
    COUNT(DISTINCT session_id) AS sessions,
    COUNT(*) FILTER (WHERE verdict = 'CONFIRMED') AS confirmed,
    COUNT(*) FILTER (WHERE verdict = 'PLAUSIBLE') AS plausible,
    COUNT(*) FILTER (WHERE verdict = 'REFUTED') AS refuted,
    COUNT(*) FILTER (WHERE verdict IS NULL) AS unverified,
    COUNT(*) FILTER (WHERE outcome = 'fixed') AS fixed,
    COUNT(*) FILTER (WHERE outcome = 'no_change_needed') AS no_change,
    COUNT(*) FILTER (WHERE outcome = 'skipped') AS skipped
  FROM deduped
  GROUP BY GROUPING SETS ((category), (category, level))
),
ranked AS (
  SELECT
    grouped.*,
    MAX(findings) FILTER (WHERE is_rollup = 1) OVER (PARTITION BY category) AS category_findings
  FROM grouped
)
SELECT
  category,
  level,
  findings,
  sessions,
  confirmed,
  plausible,
  refuted,
  unverified,
  ROUND(100.0 * confirmed / NULLIF(confirmed + plausible + refuted, 0), 1) AS confirmed_pct,
  fixed,
  no_change,
  skipped,
  ROUND(100.0 * fixed / NULLIF(fixed + no_change + skipped, 0), 1) AS acted_pct
FROM ranked
WHERE category_findings >= COALESCE(getvariable('min_findings'), 1)
ORDER BY category_findings DESC, category, is_rollup DESC, level;
