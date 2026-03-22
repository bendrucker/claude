CREATE OR REPLACE VIEW tool_errors AS
SELECT
  er.tool_use_id as tool_id,
  er.result_content as error_content,
  COALESCE(tc.tool_name, 'unknown') as tool_name,
  er.session_id,
  tc.project_path,
  er.timestamp,
  CASE
    WHEN er.result_content LIKE 'Interrupted by user%' THEN 'rejection'
    WHEN er.result_content LIKE 'Permission to use%has been auto-denied%' THEN 'rejection'
    WHEN er.result_content LIKE 'User rejected%' THEN 'rejection'
    WHEN er.result_content LIKE 'Tool use was rejected%' THEN 'rejection'
    ELSE 'failure'
  END as error_type
FROM messages er
LEFT JOIN tool_calls tc ON er.tool_use_id = tc.tool_id
WHERE er.item_type = 'tool_result'
  AND er.is_error;
