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

CREATE TABLE IF NOT EXISTS meta (
  host            VARCHAR,
  last_import     TIMESTAMP
);

-- Tracks the ingestion schema version. When db.ts bumps INDEX_VERSION past the
-- stored value, migrateIfNeeded drops the cache so the next run re-ingests every
-- JSONL line under the current import logic (e.g. when ingestion stops filtering
-- record types). Single-row table.
CREATE TABLE IF NOT EXISTS index_meta (
  version         INTEGER
);
