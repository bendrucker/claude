CREATE TABLE IF NOT EXISTS messages (
  session_id VARCHAR,
  type VARCHAR,
  timestamp VARCHAR,
  project_path VARCHAR,
  git_branch VARCHAR,
  is_meta BOOLEAN,
  content_text VARCHAR,
  item_type VARCHAR,
  tool_name VARCHAR,
  tool_id VARCHAR,
  tool_use_id VARCHAR,
  result_content VARCHAR,
  is_error BOOLEAN,
  summary VARCHAR
);

CREATE TABLE IF NOT EXISTS meta (
  last_import TIMESTAMP
);
