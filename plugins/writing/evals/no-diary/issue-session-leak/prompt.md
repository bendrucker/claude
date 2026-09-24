no-diary this issue

---
## Loader drops rows

While pairing with Claude on the DuckDB migration I noticed something odd. At first I thought the loader was fine, but then I checked the row counts and they didn't line up. I went back and forth on whether this was a join problem or a streaming problem. After digging through the transcript I realized the LEFT JOIN fans out whenever `external_id` repeats.

Anyway, the loader should probably dedupe on `external_id` before the join.
---
