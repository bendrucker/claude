#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/webhooks
cat > src/webhooks/deliver.ts <<'TS'
import type { Subscription } from "./subscriptions";

export async function deliver(sub: Subscription, event: { type: string; payload: unknown }) {
  await fetch(sub.url, { method: "POST", body: JSON.stringify(event) });
}
TS
cat > src/webhooks/subscriptions.ts <<'TS'
export interface Subscription {
  id: string;
  url: string;
  events: string[];
}

export const subscriptions: Subscription[] = [];
TS
cat > src/webhooks/dispatch.ts <<'TS'
import { deliver } from "./deliver";
import { subscriptions } from "./subscriptions";

export async function dispatch(event: { type: string; payload: unknown }) {
  await Promise.all(subscriptions.filter((s) => s.events.includes(event.type)).map((s) => deliver(s, event)));
}
TS
