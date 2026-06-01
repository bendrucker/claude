SELECT
  tc.session_id,
  tc.text
FROM text_content tc
JOIN sessions s USING (host, session_id)
WHERE (getvariable('role') IS NULL OR tc.role = getvariable('role'))
  AND (getvariable('model') IS NULL OR (tc.model IS NOT NULL AND tc.model GLOB getvariable('model')::VARCHAR))
  AND date_filter(tc.timestamp, getvariable('after_date'), getvariable('before_date'))
  AND project_filter(s.project_path, getvariable('project'))
  AND (getvariable('min_chars') IS NULL OR length(tc.text) >= getvariable('min_chars')::BIGINT)
  AND (getvariable('human_only') IS NULL OR getvariable('human_only')::VARCHAR = 'false' OR (NOT tc.is_subagent AND NOT tc.is_system));
