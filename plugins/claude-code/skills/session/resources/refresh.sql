SET VARIABLE changed_files = (
  SELECT COALESCE(LIST(filename), [])
  FROM read_text(getvariable('projects_glob'))
  WHERE last_modified > (SELECT last_import FROM meta LIMIT 1)
);

DELETE FROM messages WHERE session_id IN (
  SELECT regexp_extract(f, '([^/]+)\.jsonl$', 1)
  FROM unnest(getvariable('changed_files')) t(f)
);
