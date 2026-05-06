CREATE TABLE IF NOT EXISTS raw (
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
  last_import     TIMESTAMP
);
