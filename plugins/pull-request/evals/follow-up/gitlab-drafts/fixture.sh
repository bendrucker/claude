#!/usr/bin/env bash
set -euo pipefail
stubs="$(dirname "$0")/../../../../../packages/eval-stubs"
bash "$stubs/install.sh"
source "$stubs/preamble.sh" https://gitlab.example.com/team/service.git

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
BASE=$(commit "2026-09-20T10:00:00Z" "webhooks: deliver account events")
git update-ref refs/remotes/origin/main "$BASE"

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
commit "2026-09-21T15:00:00Z" "webhooks: retry failed deliveries with exponential backoff" > /dev/null

sed -i.bak -e 's/  const delay = BASE_DELAY_MS \* 2 \*\* attempt;/  const delayMs = BASE_DELAY_MS * 2 ** attempt;/' -e 's/  return Math.min(delay, MAX_DELAY_MS);/  return Math.min(delayMs, MAX_DELAY_MS);/' src/webhooks/retry.ts
rm src/webhooks/retry.ts.bak
commit "2026-09-23T09:15:00Z" "webhooks: rename delay to delayMs" > /dev/null

sed -i.bak 's/  const maxAttempts = process.env.WEBHOOK_MAX_ATTEMPTS ?? 8;/  const maxAttempts = Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 8);/' src/webhooks/retry.ts
rm src/webhooks/retry.ts.bak
HEAD_SHA=$(commit "2026-09-24T10:40:00Z" "webhooks: parse WEBHOOK_MAX_ATTEMPTS as a number")

jq -n --arg root "$PWD" --arg base "$BASE" --arg head "$HEAD_SHA" -f /dev/stdin > "$HOME/.eval-stubs/meta.json" <<'JQ'
def user($u): {
  bendrucker: {id: 311, username: "bendrucker", name: "Ben Drucker", bot: false},
  jlee: {id: 402, username: "jlee", name: "Jamie Lee", bot: false},
  akumar: {id: 517, username: "akumar", name: "Anil Kumar", bot: false},
  group_1187_bot_5e2f0c9a7d4b: {id: 9120, username: "group_1187_bot_5e2f0c9a7d4b", name: "CodeRabbit", bot: true}
}[$u];
def pos($path; $line): {base_sha: $base, start_sha: $base, head_sha: $head, old_path: $path, new_path: $path, position_type: "text", old_line: null, new_line: $line, line_range: null};
def note($id; $u; $at; $body): {id: $id, type: "DiscussionNote", body: $body, author: user($u), created_at: $at, updated_at: $at, system: false, noteable_type: "MergeRequest", noteable_iid: 89};
def diffnote($id; $u; $at; $path; $line; $body): note($id; $u; $at; $body) + {type: "DiffNote", position: pos($path; $line)};
def thread($id; $resolved; $notes): {id: $id, individual_note: false, notes: ($notes | map(. + {resolvable: true, resolved: $resolved, resolved_by: (if $resolved then user("bendrucker") else null end)}))};
def sysnote($did; $id; $at; $body): {id: $did, individual_note: true, notes: [note($id; "bendrucker"; $at; $body) + {type: null, system: true, resolvable: false}]};
{
  root: $root,
  host: "gitlab.example.com",
  project: "team/service",
  projectId: 4521,
  viewer: user("bendrucker"),
  mr: {
    iid: 89,
    title: "Retry failed webhook deliveries with backoff",
    description: "Failed deliveries go to a `webhook_retries` queue and retry with exponential backoff, up to `WEBHOOK_MAX_ATTEMPTS`.",
    author: user("bendrucker"),
    reviewers: [user("jlee"), user("akumar")],
    source_branch: "webhook-retries",
    created_at: "2026-09-21T15:30:00.000Z",
    updated_at: "2026-09-24T10:40:30.000Z"
  },
  versions: [{id: 1, head: $head, base: $base, start: $base, created_at: "2026-09-24T10:40:30.000Z"}],
  discussions: [
    thread("3f9c1e0a7b2d4c6e8f0a1b2c3d4e5f6a7b8c9d01"; false; [
      diffnote(1880401; "group_1187_bot_5e2f0c9a7d4b"; "2026-09-22T08:31:12.000Z"; "src/webhooks/retry.ts"; 26; "_⚠️ Potential issue_\n\n**`WEBHOOK_MAX_ATTEMPTS` is compared as a string.**\n\n`process.env` values are strings, so `delivery.attempt + 1 >= \"5\"` relies on coercion, and a value like `\"5 \"` or `\"\"` changes the retry budget silently. Parse it once:\n\n```diff\n-  const maxAttempts = process.env.WEBHOOK_MAX_ATTEMPTS ?? 8;\n+  const maxAttempts = Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 8);\n```")
    ]),
    thread("5a1b9d2e4f6c8a0b1c3d5e7f9a0b2c4d6e8f0a12"; false; [
      diffnote(1880402; "akumar"; "2026-09-22T11:02:40.000Z"; "src/webhooks/queue.ts"; 12; "Why a separate `webhook_retries` table instead of reusing the jobs queue?"),
      diffnote(1880403; "bendrucker"; "2026-09-22T12:30:05.000Z"; "src/webhooks/queue.ts"; 12; "The jobs queue drops entries after 24 hours, and a retry can run for up to three days.")
    ]),
    thread("7c2d0e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c23"; true; [
      diffnote(1880404; "akumar"; "2026-09-22T11:05:18.000Z"; "src/webhooks/retry.ts"; 13; "Nit: `delayMs` rather than `delay`, to match `BASE_DELAY_MS`."),
      diffnote(1880405; "bendrucker"; "2026-09-23T09:20:44.000Z"; "src/webhooks/retry.ts"; 13; "Renamed.")
    ]),
    sysnote("9e4f2a0b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e34"; 1880406; "2026-09-23T09:15:30.000Z"; "added 1 commit\n\n<ul><li>3e22881 - webhooks: rename delay to delayMs</li></ul>"),
    thread("b1e3a5c7d9f1b3d5f7a9c1e3b5d7f9a1c3e5b745"; false; [
      diffnote(1880407; "jlee"; "2026-09-23T14:10:02.000Z"; "src/webhooks/retry.ts"; 32; "The backoff has no jitter, so after an outage every failed delivery retries at the same instant and we hammer the customer endpoint again. Can we add full jitter here?")
    ]),
    thread("d3f5b7d9f1a3c5e7a9b1d3f5a7c9e1b3d5f7a956"; false; [
      note(1880408; "jlee"; "2026-09-23T14:16:37.000Z"; "Can you document `WEBHOOK_MAX_ATTEMPTS` in the README's configuration table?") + {position: null}
    ]),
    sysnote("f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f167"; 1880409; "2026-09-24T10:40:30.000Z"; "added 1 commit\n\n<ul><li>d5bf26e - webhooks: parse WEBHOOK_MAX_ATTEMPTS as a number</li></ul>")
  ]
}
JQ
