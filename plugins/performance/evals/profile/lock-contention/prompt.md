/performance:profile ./build/ingest

`ingest` runs eight worker threads on a 10-core machine, but adding threads stopped helping a while ago. Where does its time go, and what should we change first?
