Here's the proposed split, as a preview only — nothing has been changed.

**File tree**

```diff
 src/
 ├── commands/
 │   └── send.ts
-└── transport.ts
+└── transport/
+    ├── client.ts      # request client: auth, post, get
+    └── event-stream.ts # SSE parsing, room to grow
```

**client.ts** — keeps everything unrelated to streaming:

```ts fragment
export function setToken(value: string): void
function headers(): Record<string, string>          // stays private
export async function post<T>(path: string, body: unknown): Promise<T>
export async function get<T>(path: string): Promise<T>
```

`headers()` needs to be shared with the stream module (it sets `accept: text/event-stream` too), so it either gets exported from `client.ts` or moved to a small shared spot. Exporting it from `client.ts` is the smaller move:

```diff
- function headers(): Record<string, string> {
+ export function headers(): Record<string, string> {
```

**event-stream.ts** — owns SSE framing, with room for the parsing logic to grow beyond one generator:

```ts fragment
import { headers } from "./client"

export async function* stream(path: string): AsyncGenerator<string>

// natural next step as parsing grows:
function parseEvent(raw: string): { event?: string; data: string }
```

**Consumer update** — the only caller today:

```diff
- import { post, stream } from "../transport";
+ import { post } from "../transport/client";
+ import { stream } from "../transport/event-stream";
```

If you'd rather not touch the import site at all, `src/transport.ts` could stay as a barrel (`export * from "./transport/client"; export * from "./transport/event-stream";`) — but since there's only one consumer, the direct-import version above is less indirection.

Want me to go ahead with this (barrel or no barrel), or adjust the split first?
