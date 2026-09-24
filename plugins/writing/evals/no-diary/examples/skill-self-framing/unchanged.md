---
fail: [no-deliberation, no-framing]
---
<rewrite>
## Retry Policy

This section explains how retries work. Retry three times with exponential backoff, starting at 200 ms. We originally used a fixed one-second interval, but moved off it after fixed intervals synchronized across workers during the April outage. Jitter every delay, since workers that fail together otherwise retry together. The reason this rule is correct is that thundering herds are expensive, as anyone who has run a queue knows.

Give up after the third failure and report the error.
</rewrite>
