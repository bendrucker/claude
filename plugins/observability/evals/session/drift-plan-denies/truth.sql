-- reference: (outcomes|hook-blocks)\.sql
SELECT count(*) AS value FROM hook_denials WHERE tool = 'ExitPlanMode' AND timestamp >= '2026-07-02';
