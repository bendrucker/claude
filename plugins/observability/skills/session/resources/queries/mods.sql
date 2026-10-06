-- ---
-- name: mods
-- tier: 2
-- summary: >-
--   Whether each mod was live and healthy: the sessions it started in, the events it
--   emitted, how many failed, and where the sessions were reached from.
-- description: >-
--   One row per (`mod`, `week`, `event_name`), read from `mod_events`, which the mod-events
--   plugin writes for every mod that depends on it.
--
--   Each mod emits `<mod>.session.start` once per session it loads in, so `sessions` on that
--   row is the mod's reach and a mod missing from a week was not loaded. `failed` counts
--   events logged at WARN or above, and `p50_ms`/`p90_ms` come from the events that carry
--   `duration_ms`. `surfaces` tallies the resource surface on the mod-events plugin's own
--   heartbeat (`local`, `mosh`, or `ssh`, judged from the herdr clients attached when the
--   session started), and is NULL
--   on every other row. Rows outlive the JSONL they came from, which retention prunes by
--   size, and every row is `local`.
-- params:
--   - after_date
--   - before_date
--   - host
-- ---
SELECT
  mod,
  date_trunc('week', ts) AS week,
  event_name,
  COUNT(DISTINCT session_id) AS sessions,
  COUNT(*) AS events,
  COUNT(*) FILTER (WHERE NOT ok) AS failed,
  quantile_cont(duration_ms, 0.5) AS p50_ms,
  quantile_cont(duration_ms, 0.9) AS p90_ms,
  CASE
    WHEN event_name = 'mod-events.session.start'
    THEN histogram(surface)::JSON
  END AS surfaces,
  MAX(ts) AS last_seen
FROM mod_events
WHERE date_filter(ts, getvariable('after_date'), getvariable('before_date'))
  AND host_filter(host, getvariable('host'))
GROUP BY mod, week, event_name
ORDER BY mod, week DESC, events DESC;
