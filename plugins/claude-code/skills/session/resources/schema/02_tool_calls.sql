CREATE OR REPLACE VIEW tool_calls AS
SELECT
  tool_name,
  tool_id,
  session_id,
  project_path,
  timestamp
FROM messages
WHERE item_type = 'tool_use'
  AND tool_name IS NOT NULL;
