-- Community extensions shared by the queries that read markdown/YAML from disk.
-- Pulled into a query process via `duckdb -readonly -init extensions.sql`, which
-- runs this before stdin so the piped query sees the extensions. Query files stay
-- pure SQL; never inline INSTALL/LOAD there. The schema/index path (refresh.ts,
-- resources/schema/) is untouched and stays extension-free.
INSTALL markdown FROM community; LOAD markdown;
INSTALL yaml FROM community; LOAD yaml;
