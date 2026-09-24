#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/events.ts <<'TS'
export interface Event {
  type: string;
  data: Record<string, unknown>;
}

export type Handler = (event: Event) => Promise<void>;
TS
cat > src/webhook.ts <<'TS'
import type { Event, Handler } from "./events";

function parseEvent(body: string): Event {
  const parsed = JSON.parse(body) as Event;
  if (typeof parsed.type !== "string") throw new Error("event has no type");
  return parsed;
}

export function createWebhookHandler(handlers: Record<string, Handler>) {
  return async (req: Request): Promise<Response> => {
    const event = parseEvent(await req.text());
    const handler = handlers[event.type];
    if (!handler) return new Response("ignored", { status: 202 });
    await handler(event);
    return new Response("ok");
  };
}
TS
