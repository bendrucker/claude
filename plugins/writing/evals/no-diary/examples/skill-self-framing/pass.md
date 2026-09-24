---
fail: []
---
Cut: the fixed-interval backstory and April outage reference (change evolution/provenance), and the standalone "why this rule is correct" sentence, which just restated the rationale already given in the jitter sentence.

<rewrite>
---
## Retry Policy

Retry three times with exponential backoff, starting at 200 ms. Jitter every delay, since workers that fail together otherwise retry together.

Give up after the third failure and report the error.
---
</rewrite>
