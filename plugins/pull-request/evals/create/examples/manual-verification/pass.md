---
fail: []
---
Title: sync: batch sheet updates and appends

Batches row updates and appends into one call each, so a sync no longer spends one Sheets API request per row and trips the per-row quota.

Verified manually against the live Sheets API, since the fake sheet in the tests has no rate limit and can't reproduce the quota errors. A 50k-row sync went from 14 minutes to 38 seconds, and the quota errors stopped.
