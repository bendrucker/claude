-- Settings for the lake's writer, read first. The writer runs from a scratch directory,
-- so spills land beside the statements publish.sql generates and go with them.
SET memory_limit = '4GiB';
SET threads = 4;
SET temp_directory = 'tmp';
SET max_temp_directory_size = '32GiB';
INSTALL ducklake; LOAD ducklake;
