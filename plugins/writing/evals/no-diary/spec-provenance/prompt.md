Take the diary out of the access spec below.

---
# Access Engine

A Postgres-native access engine, decided in the 2026-08-24 authorization evaluation after we benchmarked spikes at 1000x production scale and read through the OpenFGA and SpiceDB docs. External engines were rejected: dual-write atomicity, tuple sync on high-cardinality tables, and list filtering are all free in SQL and pathological in a sidecar. Note that this is not an attempt to reinvent authorization from scratch.

Grants live in the app database and share transactions with the rows they protect.
---
