-- An interruption is the harness's marker as a text item of its own. A tool result that contains
-- the marker is quoting source or a transcript, not recording an interruption.
SELECT count(DISTINCT (data->>'$.uuid')) AS value
FROM items
WHERE timestamp >= '2026-09-01' AND timestamp < '2026-10-01'
  AND (data->>'$.type') = 'user'
  AND starts_with(item->>'$.text', '[Request interrupted by user');
