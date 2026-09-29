#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

# The session's zsh reads $HOME/.zshenv, so the stub glab shadows the real one.
stub="$HOME/.local/stub"
mkdir -p "$stub"
cp "$here/glab.ts" "$stub/glab"
chmod +x "$stub/glab"
echo "export PATH=\"$stub:\$PATH\"" >> "$HOME/.zshenv"

git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://gitlab.example.com/team/service.git

commit() {
  GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -qam "$2"
}

mkdir -p src/webhooks
cat > package.json <<'JSON'
{ "name": "service", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > README.md <<'MD'
# service

Delivers account events to customer webhooks.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEBHOOK_TIMEOUT_MS` | `5000` | Per-request timeout |
MD
cat > src/webhooks/deliver.ts <<'TS'
export interface Delivery {
  id: string;
  url: string;
  payload: unknown;
  attempt: number;
}

export async function deliver(delivery: Delivery): Promise<boolean> {
  const timeout = Number(process.env.WEBHOOK_TIMEOUT_MS ?? 5000);
  const response = await fetch(delivery.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(delivery.payload),
    signal: AbortSignal.timeout(timeout),
  });
  return response.ok;
}
TS
git add -A
commit "2026-09-20T10:00:00Z" "webhooks: deliver account events"
git update-ref refs/remotes/origin/main HEAD

git switch -qc webhook-retries
cat > src/webhooks/queue.ts <<'TS'
import type { Delivery } from "./deliver";

export interface RetryQueue {
  push(delivery: Delivery, at: Date): Promise<void>;
  due(now: Date): Promise<Delivery[]>;
}

/**
 * A dedicated queue for webhook retries, backed by the `webhook_retries`
 * table. Entries stay until delivered or abandoned.
 */
export function createRetryQueue(db: import("../db").Db): RetryQueue {
  return {
    async push(delivery, at) {
      await db.webhookRetries.insert({ ...delivery, runAt: at });
    },
    async due(now) {
      const rows = await db.webhookRetries.due(now);
      return rows.map((row) => ({ ...row, attempt: row.attempt }));
    },
  };
}
TS
cat > src/webhooks/retry.ts <<'TS'
import { deliver, type Delivery } from "./deliver";
import type { RetryQueue } from "./queue";

const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 6 * 60 * 60 * 1000;

export interface RetryResult {
  delivered: boolean;
  abandoned: boolean;
}

export function backoff(attempt: number): number {
  const delay = BASE_DELAY_MS * 2 ** attempt;
  return Math.min(delay, MAX_DELAY_MS);
}

export async function deliverWithRetry(
  delivery: Delivery,
  queue: RetryQueue,
  now = new Date(),
): Promise<RetryResult> {
  if (await deliver(delivery)) {
    return { delivered: true, abandoned: false };
  }

  const maxAttempts = process.env.WEBHOOK_MAX_ATTEMPTS ?? 8;
  if (delivery.attempt + 1 >= maxAttempts) {
    return { delivered: false, abandoned: true };
  }

  const next = { ...delivery, attempt: delivery.attempt + 1 };
  const wait = backoff(next.attempt);
  await queue.push(next, new Date(now.getTime() + wait));
  return { delivered: false, abandoned: false };
}

export async function drain(queue: RetryQueue, now = new Date()): Promise<number> {
  const due = await queue.due(now);
  let delivered = 0;
  for (const delivery of due) {
    const result = await deliverWithRetry(delivery, queue, now);
    if (result.delivered) delivered++;
  }
  return delivered;
}
TS
git add -A
commit "2026-09-21T15:00:00Z" "webhooks: retry failed deliveries with exponential backoff"

sed -i.bak -e 's/  const delay = BASE_DELAY_MS \* 2 \*\* attempt;/  const delayMs = BASE_DELAY_MS * 2 ** attempt;/' -e 's/  return Math.min(delay, MAX_DELAY_MS);/  return Math.min(delayMs, MAX_DELAY_MS);/' src/webhooks/retry.ts
rm src/webhooks/retry.ts.bak
commit "2026-09-23T09:15:00Z" "webhooks: rename delay to delayMs"

sed -i.bak 's/  const maxAttempts = process.env.WEBHOOK_MAX_ATTEMPTS ?? 8;/  const maxAttempts = Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 8);/' src/webhooks/retry.ts
rm src/webhooks/retry.ts.bak
commit "2026-09-24T10:40:00Z" "webhooks: parse WEBHOOK_MAX_ATTEMPTS as a number"
