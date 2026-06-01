INSTALL fts;
LOAD fts;

DROP TABLE IF EXISTS fts_assistant_corpus;
DROP TABLE IF EXISTS fts_user_corpus;

CREATE TABLE fts_assistant_corpus AS
  SELECT row_number() OVER () AS id, text
  FROM text_content tc
  JOIN sessions s USING (host, session_id)
  WHERE tc.role = 'assistant'
    AND date_filter(tc.timestamp, getvariable('after_date'), getvariable('before_date'))
    AND (tc.model IS NOT NULL AND tc.model GLOB getvariable('model')::VARCHAR)
    AND project_filter(s.project_path, getvariable('project'))
    AND length(tc.text) >= 50;

CREATE TABLE fts_user_corpus AS
  SELECT row_number() OVER () AS id, text
  FROM text_content tc
  JOIN sessions s USING (host, session_id)
  WHERE tc.role = 'user'
    AND NOT tc.is_subagent
    AND NOT tc.is_system
    AND date_filter(tc.timestamp, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND length(tc.text) >= 50;

PRAGMA create_fts_index('fts_assistant_corpus', 'id', 'text', stemmer='porter', stopwords='english', overwrite=1);
PRAGMA create_fts_index('fts_user_corpus', 'id', 'text', stemmer='porter', stopwords='english', overwrite=1);
