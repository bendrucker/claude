Sessions in our API never expire. We write them to Redis without a TTL on login, so a session id captured from a cookie stays valid forever. I want session expiration: an idle session should expire after a few minutes of inactivity, and every session should become invalid after an absolute cap of a few hours no matter how recently it was used.

Here is the relevant part of the service. It is a TypeScript HTTP API on Express with a Redis instance already wired up. Auth is cookie-based: the browser sends a `sid` cookie, and the middleware loads the session from Redis.

```
src/
  server.ts            # express app, mounts routers, cookie-parser
  routes/
    auth.ts            # POST /login, POST /logout (login below)
    me.ts              # GET /me, reads req.session
  lib/
    redis.ts           # shared redis client: redis.get/set/del, set opts { EX, NX }
    sessions.ts        # createSession(userId) -> sid
  middleware/
    auth.ts            # loads session from Redis, sets req.session (below)
```

`middleware/auth.ts`:

```ts
import type { Request, Response, NextFunction } from "express";
import { redis } from "../lib/redis";

export async function auth(req: Request, res: Response, next: NextFunction) {
  const sid = req.cookies.sid;
  if (!sid) return res.status(401).json({ error: "no session" });

  const raw = await redis.get("session:" + sid);
  if (!raw) return res.status(401).json({ error: "invalid session" });

  req.session = JSON.parse(raw);
  next();
}
```

`lib/sessions.ts`:

```ts
import { randomUUID } from "crypto";
import { redis } from "./redis";

export async function createSession(userId: string): Promise<string> {
  const sid = randomUUID();
  const session = { userId, createdAt: Date.now() };
  await redis.set("session:" + sid, JSON.stringify(session));
  return sid;
}
```

`createSession` is called from the `POST /login` handler in `routes/auth.ts` after the password check passes. The stored value is the JSON above. Right now nothing reads `createdAt`.

This is about session lifetime only. Don't turn it into an auth rewrite, and I'm not looking for refresh tokens or OAuth here. Plan the implementation.
