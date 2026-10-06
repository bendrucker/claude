-- ---
-- name: index-health
-- tier: 1
-- summary: >-
--   The index auditing itself. Run it first in any analysis pass, since its alerts cap what
--   the rest can claim.
-- description: >-
--   Every other named query assumes the index reflects reality. This one checks the index
--   against its own history and against the disk, surfacing the ways a query can return a
--   confidently wrong answer with no error. One row per issue (`check_name`, `status`,
--   `subject`, `detail`), alerts before info. It deliberately takes no date, project, or
--   host scoping, because health is corpus-level. An empty alert set means these checks
--   found nothing, not that the index is complete: thinking text, cloud sessions, and
--   pre-retention history are structurally absent (see SKILL.md "Known Blind Spots").
--
--   Alerts. `stream-silent` is a record kind that posted regularly and then went quiet
--   longer than its own worst historical gap, the signature of an upstream rename or
--   removal that leaves every query reading that kind returning stale or empty results with
--   no staleness signal. `host-staleness` is an imported host whose newest record lags the
--   corpus, so cross-host queries read a dead snapshot as an idle machine. `disk-not-indexed`
--   is JSONL files on disk missing from the index, which also catches files created since
--   the last refresh, so rerun `refresh.ts --refresh` before reading one as a refresh
--   failure or glob drift.
--
--   Info. `stream-migrated` is the same silence with a registered successor field still
--   arriving on another record type, named in `detail`, so the kind's zero is a rename
--   rather than an absence. `stream-new` is kinds first seen recently, shipping unconsumed,
--   each a triage prompt. `hook-deny-invisible` measures denies recovered from tool_results
--   against the PreToolUse blocks `hook_events` actually recorded over the same window,
--   sizing how much blocking a `hook_events`-only reading misses, and alerts when recovery
--   exceeds what was recorded. Its detail breaks out how many were a subagent being denied.
--   `null-timestamp-kinds` is kinds whose rows carry no timestamp, which `date_filter`
--   excludes from every date-scoped query. `indexed-not-on-disk` is indexed files deleted
--   from disk, dropped by the next refresh rather than retained. `corpus-window` is the span
--   each host actually covers, the floor under any all-time claim.
-- params:
--   - name: min_active_days
--     default: 5
--     meaning: stream-silent eligibility
--   - name: new_days
--     default: 14
--     meaning: stream-new window
--   - name: stale_days
--     default: 2
--     meaning: host-staleness threshold
--   - name: deny_window_days
--     default: 30
--     meaning: hook-deny-invisible window
--   - name: projects_glob
--     default: '~/.claude/projects/**/*.jsonl'
--     meaning: >-
--       the disk check's glob, which needs the same override given to refresh.ts when
--       CLAUDE_PROJECTS_DIR is customized
-- ---
-- stream-silent judges silence against the kind's own gap distribution, so kinds that are
-- bursty by nature do not false-positive.
--
-- hook-deny-invisible emits a row even when the recovered count is zero, because zero is
-- itself ambiguous: either nothing was denied, or the hand-maintained pattern map in
-- views.sql has fallen behind a reworded hook.
--
-- The disk checks cover the local host only. Imported hosts' files live under
-- session-imports/ and are covered by their own refresh watermark.
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
-- Grouped by kind alone so the registry can hold several successors for one kind
-- without fanning the LEFT JOIN below into duplicate health rows. `last_seen` is a
-- day (kind_stats aggregates MAX over dates), so the comparison is day-granular
-- too: casting it to a timestamp would read as midnight and let a successor
-- arriving later on the kind's own last active day pass as evidence of a
-- migration.
successor_activity AS (
  SELECT
    s.kind,
    string_agg(DISTINCT s.successor_field, ' and ') AS successor_field,
    COUNT(*) AS successor_rows,
    MAX(r.timestamp)::DATE AS successor_last_seen
  FROM kind_successors s
  JOIN kind_stats ks ON ks.kind = s.kind
  JOIN records r
    ON json_extract_string(r.data, '$.' || s.successor_field) = s.successor_value
   AND r.timestamp::DATE > ks.last_seen
  GROUP BY s.kind
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
deny_window AS (
  SELECT
    COALESCE(TRY_CAST(getvariable('deny_window_days') AS INTEGER), 30) AS days,
    c.max_ts - INTERVAL (COALESCE(TRY_CAST(getvariable('deny_window_days') AS INTEGER), 30)) DAY AS since
  FROM corpus c
),
deny_by_hook AS (
  SELECT
    hd.hook_name,
    COUNT(*) AS cnt,
    COUNT(*) FILTER (WHERE hd.agent_id IS NOT NULL) AS subagent_cnt
  FROM hook_denies hd, deny_window w
  WHERE hd.timestamp >= w.since
  GROUP BY hd.hook_name
),
deny_recovered AS (
  SELECT
    (SELECT COALESCE(SUM(cnt), 0) FROM deny_by_hook) AS n,
    (SELECT COALESCE(SUM(subagent_cnt), 0) FROM deny_by_hook) AS subagent_n,
    (SELECT string_agg(hook_name || ' (' || cnt || ')', ', ' ORDER BY cnt DESC)
     FROM (SELECT hook_name, cnt FROM deny_by_hook ORDER BY cnt DESC LIMIT 5)) AS top_hooks
),
deny_observed AS (
  SELECT
    COUNT(*) FILTER (WHERE hb.decision = 'deny') AS denies,
    COUNT(*) AS blocks
  FROM hook_blocks hb, deny_window w
  WHERE hb.hook_event = 'PreToolUse' AND hb.timestamp >= w.since
),
deny_visibility AS (
  SELECT
    'hook-deny-invisible' AS check_name,
    CASE WHEN r.n > o.denies THEN 'alert' ELSE 'info' END AS status,
    r.n || ' denies recovered' AS subject,
    'over the last ' || w.days || ' days, against ' || o.denies
      || ' denies and ' || o.blocks
      || ' PreToolUse blocks of any kind that hook_events recorded. A hook returning '
      || 'permissionDecision deny writes no hook record, so a hook_events-only reading '
      || 'under-reports blocking by the recovered count. Read the hook_denies view '
      || 'alongside hook_blocks (hook-blocks.sql does). A zero here means either no '
      || 'denies or a stale pattern map in views.sql. '
      || r.subagent_n || ' of the recovered denies were a subagent being denied, carried '
      || 'on the parent session id. hook_blocks sees none of those either, so they belong '
      || 'in this count, while a per-session reading has to key on agent_id'
      || COALESCE('. Top: ' || r.top_hooks, '') AS detail
  FROM deny_recovered r, deny_observed o, deny_window w
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
    'indexed but deleted from disk (expected under cleanupPeriodDays); the next '
      || 'refresh drops these rows, since the index mirrors disk rather than archiving it'
      AS detail
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
  UNION ALL SELECT * FROM deny_visibility
  UNION ALL SELECT * FROM new_kinds
  UNION ALL SELECT * FROM null_ts_summary
  UNION ALL SELECT * FROM disk_vanished
  UNION ALL SELECT * FROM window_info
)
SELECT check_name, status, subject, detail
FROM combined
ORDER BY status = 'alert' DESC, check_name, subject;
