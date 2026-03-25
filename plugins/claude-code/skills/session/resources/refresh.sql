SET VARIABLE last_import_time = COALESCE(
  (SELECT last_import FROM meta LIMIT 1),
  '1970-01-01'::TIMESTAMP
);

SET VARIABLE changed_files = (
  SELECT COALESCE(LIST(filename), [])
  FROM read_text(getvariable('projects_glob'))
  WHERE last_modified > getvariable('last_import_time')
);
