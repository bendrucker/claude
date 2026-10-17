---
fail: []
---
<issue>
---
title: Webhook retries resend deliveries that already returned 200
type: bug
priority: high
---

`RetryWorker` re-enqueues deliveries that already succeeded, so customers receive `order.created` and `order.updated` twice and process them twice. Idempotency keys from [TEAM-204](https://tracker.example.com/issue/TEAM-204) would let receivers drop the duplicates, but the retry itself is the bug.

## Cause

`deliver_event` records `status_code` and `delivered_at` on `DeliveryAttempt`. `RetryWorker` decides a delivery failed without reading either field.

## Expected Behavior

A delivery with a 2xx `status_code` is never retried.
</issue>
