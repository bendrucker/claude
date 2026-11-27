-- DuckLake's own maintenance: flush inlined rows, merge small files, expire snapshots older
-- than seven days, and delete the files only those snapshots referenced. The window must
-- outlast the longest reader, which may still be reading an expired snapshot.
.bail on
CALL lake.set_option('expire_older_than', '7 days');
CALL lake.set_option('delete_older_than', '7 days');
USE lake;
CHECKPOINT;
