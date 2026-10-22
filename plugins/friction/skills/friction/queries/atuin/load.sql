-- Scans Atuin's history and keeps the window ending on `day`
-- (default today) and spanning `days` (default 1). `atuin_db` is the database path.
-- timestamp and duration are nanoseconds. Imported rows carry exit = -1 and duration = 0.
INSTALL sqlite;
LOAD sqlite;
SET TimeZone = 'America/Los_Angeles';

CREATE TABLE runs AS
SELECT strftime(to_timestamp(timestamp / 1e9), '%Y-%m-%d') AS day,
  array_to_string(string_split(command, ' ')[1:2], ' ') AS head, exit, duration
FROM sqlite_scan(getvariable('atuin_db'), 'history')
WHERE deleted_at IS NULL AND exit != -1
  AND timestamp >= epoch((coalesce(getvariable('day'), current_date)::DATE - (coalesce(getvariable('days'), 1) - 1))::TIMESTAMPTZ) * 1e9
  AND timestamp < epoch((coalesce(getvariable('day'), current_date)::DATE + 1)::TIMESTAMPTZ) * 1e9;
