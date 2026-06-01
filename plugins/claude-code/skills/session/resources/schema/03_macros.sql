CREATE OR REPLACE MACRO date_filter(ts, after_val, before_val) AS
  (after_val IS NULL OR ts >= after_val::TIMESTAMP)
  AND (before_val IS NULL OR ts <= before_val::TIMESTAMP);

CREATE OR REPLACE MACRO project_filter(path, project_val) AS
  (project_val IS NULL OR SPLIT_PART(path, '/', -1) GLOB project_val::VARCHAR);

CREATE OR REPLACE MACRO host_filter(host_col, host_val) AS
  (host_val IS NULL OR host_col = host_val::VARCHAR);

CREATE OR REPLACE MACRO project_id(host, path) AS host || ':' || path;
