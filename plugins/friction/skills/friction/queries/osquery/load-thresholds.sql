-- Suggests the load mod's `remind`, `warn`, and `refuse` (load average per core) from how idle the CPU was at each load.
-- Each is the lowest half-core step whose samples at or above it, 30 minutes or more of them, meet its rule:
-- `remind` at a median under 30% idle, `warn` at a fifth of samples under 10% idle, `refuse` at a median under 10% idle.
-- NULL means the window never met the rule. Samples logged before the `pressure` query recorded `cores` are skipped.
WITH samples AS (
  SELECT p.load1 / p.cores AS lpc, h.idle_pct
  FROM pressure p ASOF JOIN host h ON p.t >= h.t
  WHERE p.cores > 0 AND p.t - h.t < 15 AND h.idle_pct IS NOT NULL),
steps AS (SELECT DISTINCT floor(lpc * 2) / 2 AS step FROM samples),
at_or_above AS (
  SELECT step, median(idle_pct) AS idle_p50, avg((idle_pct < 10)::INT) AS saturated
  FROM steps JOIN samples ON lpc >= step
  GROUP BY step HAVING count(*) >= 180)
SELECT min(step) FILTER (WHERE idle_p50 < 30) AS remind,
  min(step) FILTER (WHERE saturated >= 0.2) AS warn,
  min(step) FILTER (WHERE idle_p50 < 10) AS refuse,
  (SELECT round(count(*) / 360, 1) FROM samples) AS hours
FROM at_or_above;
