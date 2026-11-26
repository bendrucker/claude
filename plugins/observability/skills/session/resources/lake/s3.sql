-- S3 access for the lake's writer and readers, read after limits.sql.
--
-- DuckDB cannot parse the credentials in the sandbox's `http_proxy` URL, so this splits it
-- into the settings DuckDB does accept, as extensions.sql does, at run time so no
-- credential lands in a file.
SET VARIABLE proxy_url = coalesce(nullif(getenv('http_proxy'), ''), getenv('HTTP_PROXY'), '');
SET http_proxy = regexp_replace(getvariable('proxy_url'), '^([a-z0-9]+://)?([^@/]*@)?([^/]*).*$', '\3');
SET http_proxy_username = regexp_extract(getvariable('proxy_url'), '^(?:[a-z0-9]+://)?([^:@/]*)(?::[^@/]*)?@', 1);
SET http_proxy_password = regexp_extract(getvariable('proxy_url'), '^(?:[a-z0-9]+://)?[^:@/]*:([^@/]*)@', 1);
INSTALL httpfs; LOAD httpfs;
SET ca_cert_file = coalesce(nullif(getenv('AWS_CA_BUNDLE'), ''), nullif(getenv('SSL_CERT_FILE'), ''), '');
SET s3_region = coalesce(nullif(getenv('AWS_REGION'), ''), 'us-east-1');
CREATE OR REPLACE SECRET lake_s3 (TYPE s3, PROVIDER credential_chain);
