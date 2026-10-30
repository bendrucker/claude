# Ad Hoc Schema Discovery

## Ask DuckDB

```sql
SELECT * FROM information_schema.columns WHERE table_schema = 'main';
DESCRIBE messages;
DESCRIBE content_items;
```

## Reaching into `data`

Wrap `data->>'$.path'` in parens before any comparison, since `=` binds tighter than `->>`.

```sql
SELECT (data->>'$.message.model') AS model
FROM messages
WHERE type = 'assistant' AND (data->>'$.message.model') IS NOT NULL
GROUP BY model;
```
