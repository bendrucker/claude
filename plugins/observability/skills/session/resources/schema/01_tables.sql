-- `raw`, the only durable table, is created by db.ts (rawDdl): its shape comes from
-- `pinned_columns`, and a CREATE TABLE AS cannot carry `data`'s compression.

-- The sessions a refresh touched, which ensureIndex rebuilds in content_items after
-- the import loop. Filled per run and emptied before the next one.
CREATE TABLE IF NOT EXISTS content_item_scope (
  host       VARCHAR,
  session_id VARCHAR
);

-- The files a refresh imported or removed, whose file_fields rows ensureIndex rebuilds
-- beside content_items. Filled per run and emptied before the next one.
CREATE TABLE IF NOT EXISTS field_scope (
  host        VARCHAR,
  source_file VARCHAR
);

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
-- a transcript, so it is not a projection of `raw`. `debug_events` holds the
-- `[Stall]` timing lines and the allow rules auto mode dropped, out of
-- `debug/<session>.txt`.
CREATE TABLE IF NOT EXISTS debug_events (
  host            VARCHAR,
  session_id      VARCHAR,
  source_file     VARCHAR,
  line            BIGINT,
  ts              TIMESTAMP,
  event           VARCHAR,
  fields          JSON
);

-- What mods emit through the mod-events plugin, out of
-- `mod-events/<session>/<mod>.<instance>.<n>.jsonl`. Its rows and `debug_events`'
-- outlive their files, which retention prunes by size.
CREATE TABLE IF NOT EXISTS mod_events (
  host            VARCHAR,
  session_id      VARCHAR,
  mod             VARCHAR,
  event_name      VARCHAR,
  ts              TIMESTAMP,
  severity        VARCHAR,
  ok              BOOLEAN,
  duration_ms     BIGINT,
  surface         VARCHAR,
  attributes      JSON,
  source_file     VARCHAR
);

-- Change catalog for debug logs, mod-events chunks, and classifier records: one row
-- per file, or per session directory for the classifier mod.
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
