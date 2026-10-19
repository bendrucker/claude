-- Per-process resource ceiling for a read-only query process, pulled in via
-- `duckdb -init limits.sql`. DuckDB's defaults (80% of RAM, every core, spill up to
-- 90% of free disk) apply to each process separately, so a fan-out of concurrent
-- readers over the index can exhaust the machine.
-- 60% of RAM, at most 4 GiB. DuckDB's process RSS runs about 0.5 GB past
-- memory_limit, so on a small host without swap its own 80% default, or a fixed
-- 4 GiB, gets the process killed instead of failing with an out-of-memory error.
-- RESET recovers that 80% default, which this scales by 0.75.
RESET memory_limit;
SET memory_limit = CAST(least(4096, 0.75 * regexp_extract(current_setting('memory_limit'), '^[0-9.]+')::DOUBLE
  * CASE regexp_extract(current_setting('memory_limit'), '([KMGT])i?B', 1)
      WHEN 'K' THEN 1 / 1024 WHEN 'M' THEN 1 WHEN 'G' THEN 1024 WHEN 'T' THEN 1048576 END) AS BIGINT) || 'MiB';
SET threads = 4;
SET max_temp_directory_size = '16GiB';
-- The default spill dir sits beside the database, which the sandbox denies. A
-- per-process dir keeps concurrent readers from sharing spill files, and DuckDB
-- removes it on exit.
SET temp_directory = rtrim(coalesce(getenv('TMPDIR'), '/tmp'), '/') || '/duckdb-' || uuid();
