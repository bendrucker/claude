Trim the diary out of this PR body.

---
This change reworks the loader. During the work I found that the LEFT JOIN assumed `external_id` was unique, which the old comment could only assert. I ran it against a real org: 1,852 rows in and 1,852 rows out, zero fan-out, so the assumption holds. I also learned that DuckDB's httpfs cache is off by default, which surprised me.

The loader now streams instead of buffering.
---
