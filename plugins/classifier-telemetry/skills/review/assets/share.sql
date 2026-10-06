-- Per tool, how many of the window's calls the engine sent to the decider.
-- Params: after_date, before_date, host.
SELECT
  tool,
  COUNT(*) AS calls,
  COUNT(*) FILTER (WHERE decision = 'ask') AS asks,
  round(100.0 * COUNT(*) FILTER (WHERE decision = 'ask') / COUNT(*), 1) AS ask_pct,
  COUNT(*) FILTER (WHERE decision = 'allow') AS allowed,
  quantile_cont(check_ms, 0.5) FILTER (WHERE decision = 'ask') AS p50_check_ms
FROM classifier_verdicts
WHERE NOT interactive
  AND date_filter(started_at, getvariable('after_date'), getvariable('before_date'))
  AND host_filter(host, getvariable('host'))
GROUP BY tool
HAVING COUNT(*) >= 10
ORDER BY asks DESC;
