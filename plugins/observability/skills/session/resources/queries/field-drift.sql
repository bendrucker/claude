-- ---
-- name: field-drift
-- summary: >-
--   Fields the harness started or stopped writing, on record kinds the corpus carried
--   before and since.
-- description: >-
--   Reads the field registry (`fields`), so it costs what `index-health` does.
--   `stream-new` keys on record kind and never fires on a new field, yet the fields that
--   mattered most (`$.effort`, `promptSource`, `toolDenialKind`) all arrived on kinds the
--   corpus already carried. `new` skips a path a view already reads, and both changes skip
--   the paths in `field_triage`. Add a path there once it is judged.
-- params:
--   - name: new_days
--     default: 45
--   - name: cutoff_date
--     meaning: an explicit boundary overriding `new_days`, for auditing a past window
--   - name: min_rows
--     default: 50
--     meaning: floor on occurrences
--   - host
-- ---
SELECT change, type || ':' || path AS field, n, strftime(first_ts, '%Y-%m-%d') AS first_seen,
  strftime(last_ts, '%Y-%m-%d') AS last_seen, first_version
FROM field_drift(COALESCE(
  TRY_CAST(getvariable('cutoff_date') AS TIMESTAMP),
  current_date - COALESCE(TRY_CAST(getvariable('new_days') AS INTEGER), 45) * INTERVAL 1 DAY
), getvariable('host'))
WHERE n >= COALESCE(TRY_CAST(getvariable('min_rows') AS BIGINT), 50)
ORDER BY change DESC, n DESC, field;
