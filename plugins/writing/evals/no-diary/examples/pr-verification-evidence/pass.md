---
fail: []
---
Cut the diary framing and applied active voice / PR-prose rules.

<rewrite>
This change reworks the loader to stream instead of buffering.

The LEFT JOIN assumes `external_id` is unique. Verified against a real org: 1,852 rows in, 1,852 rows out, zero fan-out.
</rewrite>

Removed:
- **Provenance/change evolution**: "During the work I found that..." and "which the old comment could only assert" — where the finding came from, not needed by a reader.
- **Verification framing**: kept the row-count evidence, cut "I ran it against a real org" and "so the assumption holds."
- **Session leakage**: dropped "I also learned that DuckDB's httpfs cache is off by default, which surprised me" — unconnected personal aside, not reflected in the diff.
