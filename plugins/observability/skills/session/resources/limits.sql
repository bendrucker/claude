-- Per-process resource ceiling for a read-only query process, pulled in via
-- `duckdb -init limits.sql`. DuckDB's defaults (80% of RAM, every core, spill up to
-- 90% of free disk) apply to each process separately, so a fan-out of concurrent
-- readers over the index can exhaust the machine.
SET memory_limit = '4GiB';
SET threads = 4;
SET max_temp_directory_size = '16GiB';
-- The default spill dir sits beside the database, which the sandbox denies. A
-- per-process dir keeps concurrent readers from sharing spill files, and DuckDB
-- removes it on exit.
SET temp_directory = rtrim(coalesce(getenv('TMPDIR'), '/tmp'), '/') || '/duckdb-' || uuid();
