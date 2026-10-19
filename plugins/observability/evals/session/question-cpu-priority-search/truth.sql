-- The prompt paraphrases the topic, so finding it takes a search over prose. Truth keys on the
-- macOS command for it, said in a message rather than an injected skill body.
SELECT DISTINCT session_id AS key
FROM items
WHERE session_id IS NOT NULL AND NOT coalesce((data->>'$.isMeta')::BOOLEAN, false)
  AND (item->>'$.type') = 'text' AND contains(lower(item->>'$.text'), 'taskpolicy');
