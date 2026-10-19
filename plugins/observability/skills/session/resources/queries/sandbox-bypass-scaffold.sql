-- ---
-- name: sandbox-bypass-scaffold
-- dimensions: [permissions-sandbox]
-- summary: >-
--   Weekly share of `dangerouslyDisableSandbox` calls whose commands already escape through
--   `excludedCommands`, the `sandbox` plugin's retirement signal.
-- description: >-
--   One row per (host, week), read from the `sandbox` mod's `bypass` events in `mod_events`.
--   The mod emits one per Bash call carrying the flag while the sandbox is on, `remind` when
--   every command in the chain matches an `excludedCommands` entry once a `cd` to the session
--   directory, a flag-backed `export`, `2>&1`, or a trailing output filter is dropped, and
--   `allow` otherwise. `scaffolded_pct` is the reminded share. `repeat_pct` is the share of
--   reminders that followed an earlier one in the same loop, which is how often the note fails
--   to land. `scaffolds` tallies what the reminded calls carried, and `allow_reasons` why the
--   rest had no escaping form. Retire the plugin once `scaffolded_pct` stays under 10% for four
--   consecutive weeks, or switch it to deny if `repeat_pct` stays high.
-- params:
--   - after_date
--   - before_date
--   - host
-- ---
WITH bypasses AS (
  SELECT
    host,
    date_trunc('week', ts) AS week,
    attributes->>'verdict' AS verdict,
    attributes->>'reason' AS reason,
    TRY_CAST(attributes->>'repeat' AS INTEGER) AS repeat,
    from_json(attributes->'scaffolds', '["VARCHAR"]') AS kinds
  FROM mod_events
  WHERE event_name = 'sandbox.bypass'
    AND date_filter(ts, getvariable('after_date'), getvariable('before_date'))
    AND host_filter(host, getvariable('host'))
),
dropped AS (
  SELECT host, week, histogram(kind)::JSON AS scaffolds
  FROM (SELECT host, week, unnest(kinds) AS kind FROM bypasses WHERE verdict = 'remind')
  GROUP BY host, week
)
SELECT
  b.host,
  b.week,
  COUNT(*) AS bypasses,
  COUNT(*) FILTER (WHERE b.verdict = 'remind') AS scaffolded,
  round(100.0 * COUNT(*) FILTER (WHERE b.verdict = 'remind') / COUNT(*), 1) AS scaffolded_pct,
  round(100.0 * COUNT(*) FILTER (WHERE b.repeat > 0) / NULLIF(COUNT(*) FILTER (WHERE b.verdict = 'remind'), 0), 1) AS repeat_pct,
  any_value(d.scaffolds) AS scaffolds,
  histogram(b.reason) FILTER (WHERE b.verdict = 'allow')::JSON AS allow_reasons
FROM bypasses b
LEFT JOIN dropped d USING (host, week)
GROUP BY b.host, b.week
ORDER BY b.week DESC, b.host;
