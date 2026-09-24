---
fail: [diff-block, diff-shows-split]
---
Only one consumer (`src/commands/send.ts`), so this is a low-risk split. Here's the shape I'd propose:

**`src/transport.ts`** (request client — auth + fetch wrapper)
```ts
const BASE = process.env.API_URL ?? "http://localhost:4000";
let token: string | undefined;

export function setToken(value: string) {
  token = value;
}

export function headers(): Record<string, string> {
  return token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : { "content-type": "application/json" };
}

export function baseUrl() {
  return BASE;
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(BASE + path, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
}

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path, { headers: headers() });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
}
```

**`src/event-stream.ts`** (new — SSE parsing, room to grow)
```ts
import { baseUrl, headers } from "./transport";

export async function* stream(path: string): AsyncGenerator<string> {
  const res = await fetch(baseUrl() + path, { headers: { ...headers(), accept: "text/event-stream" } });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const e of events) yield e.replace(/^data: /, "");
  }
}
```

**`src/commands/send.ts`** — import changes from:
```ts
import { post, stream } from "../transport";
```
to:
```ts
import { post } from "../transport";
import { stream } from "../event-stream";
```

Notes:
- `headers()` needs to become exported since `event-stream.ts` needs it; I added a small `baseUrl()` export too rather than having `event-stream.ts` reach into `process.env` itself, so there's one source of truth for the base URL.
- No re-export shim in `transport.ts` — since there's only one call site, I'd just fix the import there rather than keep `stream` re-exported for back-compat.
- This is a clean split at current size; if the SSE module keeps growing (e.g. retry/backoff, multiple event types), it might eventually want its own test file too, but nothing else needs to change structurally yet.

Want me to go ahead and make these edits?
