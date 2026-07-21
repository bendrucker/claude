-- Index self-audit: checks the instrument before trusting its readings. Every other
-- named query assumes the index reflects reality; this one checks the index against
-- its own history and against the disk, surfacing the ways a query can return a
-- confidently wrong answer with no error. Run it FIRST in any discovery or analysis
-- pass (references/discovery.md wires it in as the opening step).
--
-- One row per issue: check_name, status ('alert' or 'info'), subject, detail.
-- Alerts sort first. An empty alert set means the checks below found nothing; it does
-- not mean the index is complete. Thinking text, cloud sessions, and pre-retention
-- history are structurally absent; see SKILL.md "Known Blind Spots".
--
-- Checks:
--   stream-silent (alert): a record kind that posted regularly and then went silent
--     longer than its own worst historical gap. The signature of an upstream rename
--     or removal: every query reading that kind now returns stale or empty results
--     with no staleness signal (e.g. attachment:diagnostics after CLI 2.1.198).
--     Silence is judged against the kind's own gap distribution so
--     bursty-by-nature kinds don't false-positive.
--   stream-migrated (info): a kind that went silent while a registered successor
--     field keeps arriving on another record type (e.g. system:api_error stopped
--     after CLI 2.1.179 and the signal moved to isApiErrorMessage on the synthetic
--     assistant message). The event did not stop, only its representation changed:
--     queries reading the kind alone under-report to zero. The detail names the
--     successor field so a depth query can read both.
--   stream-new (info): a kind first seen recently. New surfaces ship unconsumed;
--     each is a triage prompt (add a view/query, or document it as noise).
--   host-staleness (alert): an imported host whose newest record lags the corpus.
--     Cross-host queries silently read a dead snapshot and conclude that machine
--     went idle; re-sync per SKILL.md "Re-syncing".
--   null-timestamp-kinds (info): kinds whose rows carry no timestamp. date_filter
--     excludes them from EVERY date-scoped query (NULL >= x is NULL), so a date
--     window hides these rows entirely.
--   disk-not-indexed (alert): JSONL files on disk missing from the index. Files
--     created since the last refresh land here too (refresh.ts marks a session
--     refreshed once and skips subsequent runs), so run refresh.ts --refresh and
--     re-check; entries that persist mean refresh failure or glob drift. Local host
--     only; imported hosts' files live under session-imports/ and are covered by
--     their own refresh watermark.
--   indexed-not-on-disk (info): indexed files deleted from disk, expected once
--     cleanupPeriodDays reaps old sessions. The index is their only surviving copy,
--     so a forced rebuild (migration) permanently loses them.
--   corpus-window (info): per host, the span the index actually covers. Any
--     "all-time" claim is bounded below by this floor.
--
-- Params (all optional): min_active_days (stream-silent eligibility, default 5),
-- new_days (stream-new window, default 14), stale_days (host-staleness
-- threshold, default 2), projects_glob (disk check, default
-- '~/.claude/projects/**/*.jsonl'; pass the same override given to refresh.ts if
-- CLAUDE_PROJECTS_DIR is customized).
WITH corpus AS (
  SELECT MIN(timestamp) AS min_ts, MAX(timestamp) AS max_ts
  FROM records
  WHERE timestamp IS NOT NULL
),
-- Highest CLI version in the corpus, by numeric segment order (string MAX would put
-- 2.1.99 above 2.1.198).
corpus_version AS (
  SELECT version
  FROM records
  WHERE version IS NOT NULL
  GROUP BY version
  ORDER BY list_transform(string_split(version, '.'), lambda x: TRY_CAST(x AS INTEGER)) DESC
  LIMIT 1
),
active_days AS (
  SELECT kind, timestamp::DATE AS day
  FROM records
  WHERE timestamp IS NOT NULL
  GROUP BY kind, day
),
gaps AS (
  SELECT
    kind,
    day,
    DATE_DIFF('day', LAG(day) OVER (PARTITION BY kind ORDER BY day), day) AS gap
  FROM active_days
),
kind_stats AS (
  SELECT
    kind,
    COUNT(*) AS active_day_count,
    MIN(day) AS first_seen,
    MAX(day) AS last_seen,
    COALESCE(MAX(gap), 1) AS max_gap
  FROM gaps
  GROUP BY kind
),
kind_rows AS (
  SELECT
    kind,
    COUNT(*) AS total,
    arg_max(version, timestamp) AS last_version
  FROM records
  WHERE timestamp IS NOT NULL
  GROUP BY kind
),
-- Kinds that stopped because an equivalent signal moved to a field on another
-- record type, not because the signal itself stopped. Without this, stream-silent
-- reports the kind as dead and every consumer concludes the event no longer
-- happens. An entry retires itself: once the old kind ages out of retention it has
-- no kind_stats row and stops emitting.
kind_successors(kind, successor_field, successor_value) AS (
  VALUES ('system:api_error', 'isApiErrorMessage', 'true')
),
successor_activity AS (
  SELECT
    s.kind,
    s.successor_field,
    COUNT(*) AS successor_rows,
    MAX(r.timestamp)::DATE AS successor_last_seen
  FROM kind_successors s
  JOIN kind_stats ks ON ks.kind = s.kind
  JOIN records r
    ON json_extract_string(r.data, '$.' || s.successor_field) = s.successor_value
   AND r.timestamp > ks.last_seen::TIMESTAMP
  GROUP BY 1, 2
),
silent_streams AS (
  SELECT
    CASE WHEN sa.kind IS NULL THEN 'stream-silent' ELSE 'stream-migrated' END AS check_name,
    CASE WHEN sa.kind IS NULL THEN 'alert' ELSE 'info' END AS status,
    ks.kind AS subject,
    'silent ' || DATE_DIFF('day', ks.last_seen::TIMESTAMP, c.max_ts)
      || ' days (worst historical gap ' || ks.max_gap
      || '); last seen ' || ks.last_seen
      || ' on version ' || COALESCE(kr.last_version, 'unknown')
      || ' (corpus now ' || (SELECT version FROM corpus_version)
      || '); ' || kr.total || ' rows over ' || ks.active_day_count
      || ' active days'
      || COALESCE('; the signal moved to the ' || sa.successor_field
                  || ' field, still arriving (' || sa.successor_rows
                  || ' rows since, last ' || sa.successor_last_seen
                  || '), read both surfaces', '') AS detail
  FROM kind_stats ks
  JOIN kind_rows kr USING (kind)
  LEFT JOIN successor_activity sa USING (kind), corpus c
  WHERE ks.active_day_count >= COALESCE(TRY_CAST(getvariable('min_active_days') AS INTEGER), 5)
    AND DATE_DIFF('day', ks.last_seen::TIMESTAMP, c.max_ts) > GREATEST(ks.max_gap, 2)
),
new_kinds AS (
  SELECT
    'stream-new' AS check_name,
    'info' AS status,
    ks.kind AS subject,
    'first seen ' || ks.first_seen || ', ' || kr.total
      || ' rows so far; a new record kind to triage (consume it in a view or query, '
      || 'or document it as noise)' AS detail
  FROM kind_stats ks
  JOIN kind_rows kr USING (kind), corpus c
  WHERE DATE_DIFF('day', ks.first_seen::TIMESTAMP, c.max_ts)
        <= COALESCE(TRY_CAST(getvariable('new_days') AS INTEGER), 14)
    -- A kind present since (near) the start of the corpus is as old as the index
    -- itself, not new; without this, a young corpus reports every kind as new.
    AND DATE_DIFF('day', c.min_ts, ks.first_seen::TIMESTAMP)
        > COALESCE(TRY_CAST(getvariable('new_days') AS INTEGER), 14)
),
host_span AS (
  SELECT
    host,
    COUNT(*) AS row_count,
    COUNT(DISTINCT source_file) AS file_count,
    MIN(timestamp) AS first_ts,
    MAX(timestamp) AS last_ts
  FROM raw
  GROUP BY host
),
stale_hosts AS (
  SELECT
    'host-staleness' AS check_name,
    'alert' AS status,
    h.host AS subject,
    'last record ' || h.last_ts::DATE || ', '
      || DATE_DIFF('day', h.last_ts, c.max_ts)
      || ' days behind the corpus; cross-host queries read this host as idle. '
      || 'Re-sync it (SKILL.md "Re-syncing")' AS detail
  FROM host_span h, corpus c
  -- Imported hosts only: the remediation is a re-sync, which does not apply to
  -- local. A lagging local corpus shows up as disk-not-indexed instead.
  WHERE h.host != 'local'
    AND DATE_DIFF('day', h.last_ts, c.max_ts)
        > COALESCE(TRY_CAST(getvariable('stale_days') AS INTEGER), 2)
),
null_ts AS (
  SELECT kind, COUNT(*) AS n
  FROM records
  GROUP BY kind
  HAVING COUNT(timestamp) = 0
),
null_ts_summary AS (
  SELECT
    'null-timestamp-kinds' AS check_name,
    'info' AS status,
    COUNT(*) || ' kinds' AS subject,
    SUM(n) || ' rows carry no timestamp and are invisible to every date-filtered '
      || 'query; largest: '
      || (SELECT string_agg(kind || ' (' || n || ')', ', ' ORDER BY n DESC)
          FROM (SELECT kind, n FROM null_ts ORDER BY n DESC LIMIT 5)) AS detail
  FROM null_ts
  HAVING COUNT(*) > 0
),
disk AS (
  SELECT file
  FROM glob(COALESCE(
    TRY_CAST(getvariable('projects_glob') AS VARCHAR),
    '~/.claude/projects/**/*.jsonl'
  ))
),
indexed AS (
  SELECT DISTINCT source_file FROM raw WHERE host = 'local'
),
disk_missing AS (
  SELECT
    'disk-not-indexed' AS check_name,
    'alert' AS status,
    COUNT(*) || ' files' AS subject,
    'on disk but absent from the index; expected for files created since the last '
      || 'refresh (run refresh.ts --refresh and re-check), persistent entries mean '
      || 'refresh failure or glob drift, e.g. '
      || (SELECT string_agg(file, ', ')
          FROM (SELECT d2.file
                FROM disk d2
                LEFT JOIN indexed i2 ON i2.source_file = d2.file
                WHERE i2.source_file IS NULL
                LIMIT 3)) AS detail
  FROM disk d
  LEFT JOIN indexed i ON i.source_file = d.file
  WHERE i.source_file IS NULL
  HAVING COUNT(*) > 0
),
disk_vanished AS (
  SELECT
    'indexed-not-on-disk' AS check_name,
    'info' AS status,
    COUNT(*) || ' files' AS subject,
    'indexed but deleted from disk (expected under cleanupPeriodDays); the index is '
      || 'their only surviving copy, and a forced rebuild loses them' AS detail
  FROM indexed i
  LEFT JOIN disk d ON d.file = i.source_file
  WHERE d.file IS NULL
  HAVING COUNT(*) > 0
),
window_info AS (
  SELECT
    'corpus-window' AS check_name,
    'info' AS status,
    host AS subject,
    file_count || ' files, ' || row_count || ' rows, '
      || first_ts::DATE || ' to ' || last_ts::DATE AS detail
  FROM host_span
),
combined AS (
  SELECT check_name, status, subject, detail FROM silent_streams
  UNION ALL SELECT * FROM stale_hosts
  UNION ALL SELECT * FROM disk_missing
  UNION ALL SELECT * FROM new_kinds
  UNION ALL SELECT * FROM null_ts_summary
  UNION ALL SELECT * FROM disk_vanished
  UNION ALL SELECT * FROM window_info
)
SELECT check_name, status, subject, detail
FROM combined
ORDER BY status = 'alert' DESC, check_name, subject;
