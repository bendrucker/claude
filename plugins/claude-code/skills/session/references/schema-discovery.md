# Ad Hoc Schema Discovery

Worked examples for exploring the schema at query time, extending [`SKILL.md`](../SKILL.md) "Discovery".

## Ask DuckDB

Don't memorize column lists.

```sql
SELECT * FROM information_schema.columns WHERE table_schema = 'main';
DESCRIBE messages;
DESCRIBE content_items;
```

## Reaching into `data`

For fields not in the pinned columns, reach into `data` directly with JSON path operators.

```sql
SELECT (data->>'$.message.model') AS model
FROM messages
WHERE type = 'assistant' AND (data->>'$.message.model') IS NOT NULL
GROUP BY model;
```

## The Parens Gotcha

Wrap `data->>'$.path'` in parens before any comparison. DuckDB parses `data->>'$.x' = 'y'` as `data->>('$.x' = 'y')` (boolean array index) and fails.
