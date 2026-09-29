Can you tighten up this commit message before I commit?

---
This commit basically leverages a brand new retry helper in order to robustly handle the flaky upstream calls that we were seeing. We cap retries at 3 because the API rate-limits us pretty aggressively after that. It should hopefully resolve the intermittent 429s that have been plaguing the nightly job.
---
