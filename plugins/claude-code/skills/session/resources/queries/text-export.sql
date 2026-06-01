SELECT
  tc.session_id,
  tc.timestamp,
  tc.role,
  tc.model,
  s.project_path,
  tc.text,
  tc.raw_text,
  tc.source_file,
  tc.source_line
FROM text_content tc
JOIN sessions s USING (host, session_id)
WHERE (getvariable('role') IS NULL OR tc.role = getvariable('role'))
  AND (getvariable('model') IS NULL OR (tc.model IS NOT NULL AND tc.model GLOB getvariable('model')::VARCHAR))
  AND date_filter(tc.timestamp, getvariable('after_date'), getvariable('before_date'))
  AND project_filter(s.project_path, getvariable('project'))
  AND host_filter(tc.host, getvariable('host'))
  AND (getvariable('min_chars') IS NULL OR length(tc.text) >= getvariable('min_chars')::BIGINT)
ORDER BY tc.timestamp, tc.source_file, tc.source_line;
