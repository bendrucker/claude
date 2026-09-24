---
fail: []
---
<rewrite>
# Access Engine

A Postgres-native access engine. Dual-write atomicity, tuple sync on high-cardinality tables, and list filtering are free in SQL and pathological in an external sidecar.

Grants live in the app database and share transactions with the rows they protect.
</rewrite>

Cut, grouped by category:

- **Provenance and deliberation** — the 2026-08-24 evaluation date, the 1000x-scale benchmark, reading the OpenFGA/SpiceDB docs, and "External engines were rejected" (kept the underlying reasoning, dropped the who/when/what-it-beat framing).
- **Self-reference** — "Note that this is not an attempt to reinvent authorization from scratch," which defends against an unstated objection rather than telling the reader anything about the system.
