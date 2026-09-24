cut the diary out of this skill file

---
## Retry Policy

This section explains how retries work. We originally used exponential backoff with jitter, but that was chosen over a fixed interval because fixed intervals synchronize across workers, which is a well-known problem in distributed systems. The reason this rule is correct is that thundering herds are expensive.

Retry three times with exponential backoff. Give up after the third failure and report the error.
---
