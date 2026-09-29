**!89 Retry failed webhook deliveries with backoff**: 5 threads, 4 open.

| Thread | State |
| --- | --- |
| `src/webhooks/retry.ts:26` (CodeRabbit): `WEBHOOK_MAX_ATTEMPTS` compared as a string | open, no reply. Fixed by d5bf26e after the comment |
| `src/webhooks/retry.ts:32` (@jlee): backoff has no jitter | open, no reply |
| README (@jlee): document `WEBHOOK_MAX_ATTEMPTS` | open, no reply |
| `src/webhooks/queue.ts:12` (@akumar): separate retry table | open, you replied |
| `src/webhooks/retry.ts:13` (@akumar): rename to `delayMs` | resolved with your reply |

## Drafts

**`src/webhooks/retry.ts:26`**
> Parsed with `Number()` in d5bf26e.

**`src/webhooks/retry.ts:32`**
> Good call. I'll add full jitter to `backoff` so retries after an outage spread across the window.

**README**
> Added a row for `WEBHOOK_MAX_ATTEMPTS` (default 8) to the configuration table.

The README and jitter drafts describe changes that aren't made yet. Want me to make those first, or post the drafts as they are?
