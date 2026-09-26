-- `raw` is the only durable table: `data` holds the verbatim JSONL line, and `host`,
-- `source_file` and `source_line` identify where it came from. Its remaining columns are
-- projections declared once in `00_pinned.sql`, so the shape is taken from that macro
-- rather than restated here and the two cannot drift.
CREATE TABLE IF NOT EXISTS raw AS
SELECT
  NULL::VARCHAR AS host,
  UNNEST(pinned_columns(NULL::JSON)),
  NULL::VARCHAR AS source_file,
  NULL::BIGINT  AS source_line,
  NULL::JSON    AS data
WHERE false;

-- Per-file change catalog: one row per indexed JSONL file with the mtime (ms) and
-- size observed at import. A file is re-imported when either differs, and its rows
-- are dropped when the path disappears. Immune to the watermark race (a write landing
-- between scan and stamp) and to mtime-preserving rsync delivering old-mtime files.
CREATE TABLE IF NOT EXISTS indexed_files (
  host            VARCHAR,
  path            VARCHAR,
  mtime           BIGINT,
  size            BIGINT
);

CREATE TABLE IF NOT EXISTS meta (
  host            VARCHAR,
  last_import     TIMESTAMP
);

-- This machine's own telemetry, read from beside its projects directory rather than from
-- a transcript, so neither table is a projection of `raw`. `debug_events` holds the
-- `[Stall]` timing lines and the allow rules auto mode dropped, out of
-- `debug/<session>.txt`. `tool_verdicts` holds the classifier-telemetry mod's per-call
-- records, out of `classifier-telemetry/<session>/<tool_use_id>.json`.
CREATE TABLE IF NOT EXISTS debug_events (
  host            VARCHAR,
  session_id      VARCHAR,
  source_file     VARCHAR,
  line            BIGINT,
  ts              TIMESTAMP,
  event           VARCHAR,
  fields          JSON
);

CREATE TABLE IF NOT EXISTS tool_verdicts (
  host            VARCHAR,
  session_id      VARCHAR,
  tool_use_id     VARCHAR,
  agent_id        VARCHAR,
  tool            VARCHAR,
  decision        VARCHAR,
  rule            VARCHAR,
  reason          VARCHAR,
  started_at      TIMESTAMP,
  check_ms        BIGINT,
  duration_ms     BIGINT,
  outcome         VARCHAR,
  source_dir      VARCHAR
);

-- The change catalog for those two, as `indexed_files` is for JSONL: a debug log per
-- file, the mod's records per session directory.
CREATE TABLE IF NOT EXISTS telemetry_files (
  source          VARCHAR,
  path            VARCHAR,
  mtime           BIGINT,
  size            BIGINT
);

-- Tracks the ingestion schema version and a fingerprint per derivation stage. Each
-- fingerprint governs how its stage is brought up to date when it changes, and none of
-- them re-reads a JSONL file:
--   views_hash   fingerprints views.sql; ensureIndex rebuilds the views and the
--                content_items table from raw.
--   import_hash  fingerprints 00_pinned.sql; ensureSchema re-derives raw's projected
--                columns from raw.data in place.
-- `version` is reserved for a change to the scan or to line identity (source_file,
-- source_line), the one kind that does need the files back. Bumping it clears
-- indexed_files so every file still on disk re-imports, and leaves rows whose file is
-- gone untouched. Single-row table.
CREATE TABLE IF NOT EXISTS index_meta (
  version         INTEGER,
  views_hash      VARCHAR,
  import_hash     VARCHAR
);

-- Databases created before import_hash existed still carry the two-column table.
ALTER TABLE index_meta ADD COLUMN IF NOT EXISTS import_hash VARCHAR;
