-- Community extensions shared by the queries that read markdown/YAML from disk.
-- Pulled into a query process via `duckdb -readonly -init extensions.sql`, which
-- runs this before stdin so the piped query sees the extensions. Query files stay
-- pure SQL; never inline INSTALL/LOAD there. The schema/index path (refresh.ts,
-- resources/schema/) is untouched and stays extension-free.

-- DuckDB cannot parse credentials in an `http_proxy` URL, which the Claude Code
-- sandbox proxy carries, so a cold-cache INSTALL fails there. Split the URL into
-- the host and credential settings DuckDB does accept.
SET VARIABLE proxy_url = coalesce(nullif(getenv('http_proxy'), ''), getenv('HTTP_PROXY'), '');
SET http_proxy = regexp_replace(getvariable('proxy_url'), '^([a-z0-9]+://)?([^@/]*@)?([^/]*).*$', '\3');
SET http_proxy_username = regexp_extract(getvariable('proxy_url'), '^(?:[a-z0-9]+://)?([^:@/]*)(?::[^@/]*)?@', 1);
SET http_proxy_password = regexp_extract(getvariable('proxy_url'), '^(?:[a-z0-9]+://)?[^:@/]*:([^@/]*)@', 1);

INSTALL markdown FROM community; LOAD markdown;
INSTALL yaml FROM community; LOAD yaml;
