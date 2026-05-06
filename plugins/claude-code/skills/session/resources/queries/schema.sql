SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'main'
  AND table_name != 'meta'
ORDER BY table_name, ordinal_position;
