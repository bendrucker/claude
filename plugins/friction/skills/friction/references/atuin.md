# Atuin Source

Atuin captures every shell command into `~/.local/share/atuin/history.db`. Attach it read-only, since it is WAL-mode with live writers:

```bash
duckdb -c "INSTALL sqlite; LOAD sqlite; SET TimeZone = 'America/Los_Angeles';
ATTACH '$HOME/.local/share/atuin/history.db' AS atuin (TYPE sqlite, READ_ONLY);
<query>"
```

`timestamp` and `duration` are nanoseconds. Filter `deleted_at IS NULL`. Imported rows carry `exit = -1` and `duration = 0`, so the queries below skip them. The target is the command head (first two words), never the arguments.

## Slow Commands

Command heads whose median run is over 30 s, per day. Interactive sessions (`ssh`, `claude`, `herdr`, editors, pagers, `tail -f`) run until you leave them, so their duration is not a wait. Skip them.

```sql
SELECT strftime(to_timestamp(timestamp / 1e9), '%Y-%m-%d') AS day,
  array_to_string(string_split(command, ' ')[1:2], ' ') AS head,
  count(*) AS runs, round(median(duration) / 1e9) AS median_s, round(sum(duration) / 6e10) AS total_min
FROM atuin.history
WHERE deleted_at IS NULL AND exit != -1 AND timestamp > (epoch(now()) - 7 * 86400) * 1e9
GROUP BY 1, 2 HAVING median(duration) > 30e9 ORDER BY 1, total_min DESC;
```

## Failing Commands

Command heads that fail at least a third of the time, with 5+ runs a day:

```sql
SELECT strftime(to_timestamp(timestamp / 1e9), '%Y-%m-%d') AS day,
  array_to_string(string_split(command, ' ')[1:2], ' ') AS head,
  count(*) AS runs, round(avg((exit != 0)::INT), 2) AS fail_rate
FROM atuin.history
WHERE deleted_at IS NULL AND exit != -1 AND timestamp > (epoch(now()) - 7 * 86400) * 1e9
GROUP BY 1, 2 HAVING count(*) >= 5 AND avg((exit != 0)::INT) >= 0.33 ORDER BY 1, runs DESC;
```

A command that fails on purpose (`grep` with no match, `test`, `diff`) is not friction. Ground each one before recording it.
