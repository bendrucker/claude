```ts fragment
interface DeliveryAttempt {
  subscriptionId: string
  attempt: number
  nextAt: Date
}

interface DeadLetter {
  subscriptionId: string
  event: WebhookEvent
  lastError: string
}

function deliverWithRetry(sub: Subscription, event: WebhookEvent, policy: RetryPolicy): Promise<void>
function recordDeadLetter(entry: DeadLetter): Promise<void>
```
