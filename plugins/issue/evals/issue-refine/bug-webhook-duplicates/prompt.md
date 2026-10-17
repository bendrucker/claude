Refine this into an issue:

Webhook deliveries are firing twice for some events. Customers integrating with us see duplicate order.created and order.updated events and are double-processing them. The retry path runs even after a delivery already returned 200.

Files:
- webhooks/dispatcher.py (deliver_event sends the POST and records the result)
- webhooks/retry_queue.py (RetryWorker re-enqueues deliveries it considers failed)
- webhooks/models.py (DeliveryAttempt stores status_code and a delivered_at timestamp)

Related issues:
- TEAM-204: Add idempotency keys to outbound webhook payloads (open, in backlog)
