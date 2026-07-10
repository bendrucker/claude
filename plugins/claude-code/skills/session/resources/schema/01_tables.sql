CREATE TABLE IF NOT EXISTS raw (
  host            VARCHAR,
  session_id      VARCHAR,
  type            VARCHAR,
  project_path    VARCHAR,
  git_branch      VARCHAR,
  is_meta         BOOLEAN,
  is_sidechain    BOOLEAN,
  duration_ms     BIGINT,
  timestamp       TIMESTAMP,
  summary         VARCHAR,
  input_tokens    BIGINT,
  output_tokens   BIGINT,
  source_file     VARCHAR,
  source_line     BIGINT,
  data            JSON
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

-- Tracks the ingestion schema version and the fingerprint of views.sql. When db.ts
-- bumps INDEX_VERSION past the stored value, migrateIfNeeded drops the cache so the
-- next run re-ingests every JSONL line under the current import logic. When views_hash
-- differs from the current views.sql, ensureIndex rebuilds the views even if no files
-- changed. Single-row table.
CREATE TABLE IF NOT EXISTS index_meta (
  version         INTEGER,
  views_hash      VARCHAR
);
