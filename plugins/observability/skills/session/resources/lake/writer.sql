-- Settings for the lake's writer, read first. The writer runs from a scratch directory,
-- so spills land beside the statements publish.sql generates and go with them.
SET memory_limit = '4GiB';
SET threads = 4;
SET temp_directory = 'tmp';
SET max_temp_directory_size = '32GiB';
INSTALL ducklake; LOAD ducklake;
-- DuckDB 2.0 still prints a stored macro's lambdas in the deprecated arrow form, which the
-- publish copies into the lake, so the writer and readers both accept it.
SET lambda_syntax = 'ENABLE_SINGLE_ARROW';
