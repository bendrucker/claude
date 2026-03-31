CREATE TABLE IF NOT EXISTS raw (
  sessionId VARCHAR,
  summary VARCHAR
);

CREATE TABLE IF NOT EXISTS meta (
  last_import TIMESTAMP
);
