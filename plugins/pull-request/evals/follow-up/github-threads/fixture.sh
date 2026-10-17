#!/usr/bin/env bash
set -euo pipefail
stubs="$(dirname "$0")/../../../../../packages/eval-stubs"
bash "$stubs/install.sh"
source "$stubs/preamble.sh" https://github.com/acme/api-server.git

mkdir -p src/routes src/middleware test
cat > package.json <<'JSON'
{ "name": "api-server", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/config.ts <<'TS'
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://localhost/api",
};
TS
cat > src/routes/orders.ts <<'TS'
import { Router } from "express";
import { db } from "../db";

export const orders = Router();

orders.get("/v1/orders", async (req, res) => {
  const rows = await db.orders.list({ tenant: req.tenant.id });
  res.json(rows);
});
TS
BASE=$(commit "2026-09-18T10:00:00Z" "api-server: orders endpoint")
git update-ref refs/remotes/origin/main "$BASE"

git switch -qc rate-limit-orders
cat > src/config.ts <<'TS'
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://localhost/api",
  rateLimit: {
    // Requests allowed per tenant in each window.
    limit: Number(process.env.RATE_LIMIT ?? 100),
    // Window length in milliseconds.
    windowMs: 60_000,
  },
};

export type RateLimitConfig = typeof config.rateLimit;
export const rateLimitDefaults: RateLimitConfig = config.rateLimit;
TS
cat > src/middleware/rate-limit.ts <<'TS'
import type { NextFunction, Request, Response } from "express";
import type { RateLimitConfig } from "../config";

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface Store {
  increment(key: string, ttlMs: number): Promise<number>;
}

export function retryAfterSeconds(result: LimitResult, now = Date.now()): number {
  return Math.max(0, Math.ceil((result.resetAt - now) / 1000));
}

export const retryAfer = retryAfterSeconds;

export class Limiter {
  constructor(
    private readonly store: Store,
    private readonly options: RateLimitConfig,
  ) {}

  private windowStart(now: number): number {
    return now - (now % this.options.windowMs);
  }

  private key(tenant: string, now: number): string {
    return `rate:${tenant}:${this.windowStart(now)}`;
  }

  /**
   * Counts this request against the tenant's current window and reports
   * whether it fits under the limit.
   */
  async check(tenant: string, now = Date.now()): Promise<LimitResult> {
    const start = this.windowStart(now);
    const resetAt = start + this.options.windowMs;
    const count = await this.store.increment(this.key(tenant, now), this.options.windowMs);
    return {
      allowed: count <= this.options.limit,
      remaining: Math.max(0, this.options.limit - count),
      resetAt,
    };
  }
}

export function rateLimit(limiter: Limiter) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const result = await limiter.check(req.tenant.id);
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    if (!result.allowed) return res.status(429).end();
    next();
  };
}
TS
cat > src/routes/orders.ts <<'TS'
import { Router } from "express";
import { config } from "../config";
import { db } from "../db";
import { Limiter } from "../middleware/rate-limit";
import { redisStore } from "../redis";

export const orders = Router();

const limiter = new Limiter(redisStore, config.rateLimit);

orders.get("/v1/orders", async (req, res) => {
  const rows = await db.orders.list({ tenant: req.tenant.id });
  res.json(rows);
});

orders.post("/v1/orders", async (req, res) => {
  const tenant = req.tenant.id;
  const result = limiter.check(tenant);
  if (!result.allowed) {
    return tooManyRequests(res);
  }

  const order = await db.orders.create({
    tenant,
    items: req.body.items,
    currency: req.body.currency ?? "USD",
  });
  res.status(201).json(order);
});

orders.get("/v1/orders/:id", async (req, res) => {
  const order = await db.orders.get({ tenant: req.tenant.id, id: req.params.id });
  if (!order) return res.status(404).end();
  res.json(order);
});

orders.delete("/v1/orders/:id", async (req, res) => {
  await db.orders.cancel({ tenant: req.tenant.id, id: req.params.id });
  res.status(204).end();
});

function validCurrency(code: unknown): code is string {
  return typeof code === "string" && /^[A-Z]{3}$/.test(code);
}

orders.use((req, _res, next) => {
  if (req.body?.currency !== undefined && !validCurrency(req.body.currency)) {
    return next(new Error("invalid currency"));
  }
  next();
});

function tooManyRequests(res: import("express").Response) {
  return res.status(503).json({ error: "rate limited" });
}
TS
cat > test/rate-limit.test.ts <<'TS'
import { describe, expect, test } from "bun:test";
import { Limiter, type Store } from "../src/middleware/rate-limit";

function memoryStore(): Store {
  const counts = new Map<string, number>();
  return {
    async increment(key) {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
  };
}

describe("Limiter", () => {
  test("allows requests under the limit", async () => {
    const limiter = new Limiter(memoryStore(), { limit: 2, windowMs: 1000 });
    expect((await limiter.check("t1")).allowed).toBe(true);
    expect((await limiter.check("t1")).allowed).toBe(true);
  });

  test("rejects requests over the limit", async () => {
    const limiter = new Limiter(memoryStore(), { limit: 1, windowMs: 1000 });
    await limiter.check("t1");
    expect((await limiter.check("t1")).allowed).toBe(false);
  });

  test("allows requests again in the next window", async () => {
    const limiter = new Limiter(memoryStore(), { limit: 1, windowMs: 1000 });
    await limiter.check("t1");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect((await limiter.check("t1")).allowed).toBe(true);
  });
});
TS
OPENED=$(commit "2026-09-19T15:00:00Z" "orders: rate-limit order creation per tenant")

sed -i.bak 's/export const retryAfer = retryAfterSeconds;/export const retryAfter = retryAfterSeconds;/' src/middleware/rate-limit.ts
rm src/middleware/rate-limit.ts.bak
commit "2026-09-22T09:10:00Z" "rate-limit: fix the retryAfter export name" > /dev/null

sed -i.bak 's/  const result = limiter.check(tenant);/  const result = await limiter.check(tenant);/' src/routes/orders.ts
rm src/routes/orders.ts.bak
HEAD_SHA=$(commit "2026-09-22T09:20:00Z" "orders: await the limiter check")

jq -n --arg root "$PWD" --arg base "$BASE" --arg opened "$OPENED" --arg head "$HEAD_SHA" -f /dev/stdin > "$HOME/.eval-stubs/meta.json" <<'JQ'
def note($author; $at; $commit; $body): {author: $author, createdAt: $at, commit: $commit, body: $body};
{
  root: $root,
  repo: "acme/api-server",
  viewer: "bendrucker",
  base: $base,
  head: $head,
  pull: {
    number: 247,
    title: "Rate-limit order creation per tenant",
    body: "Adds a per-tenant limiter in front of `POST /v1/orders`, backed by Redis.",
    author: "bendrucker",
    headRefName: "rate-limit-orders",
    createdAt: "2026-09-19T16:00:00Z"
  },
  reviews: [
    {id: 1900, author: "priya-k", state: "COMMENTED", submittedAt: "2026-09-20T14:06:00Z", commit: $opened},
    {id: 1901, author: "coderabbitai", bot: true, state: "COMMENTED", submittedAt: "2026-09-21T08:45:30Z", commit: $opened, body: "**Actionable comments posted: 1**"},
    {id: 1902, author: "mchen", state: "CHANGES_REQUESTED", submittedAt: "2026-09-21T16:32:00Z", commit: $opened, body: "A couple of API behavior questions."},
    {id: 1903, author: "mchen", state: "COMMENTED", submittedAt: "2026-09-24T11:13:10Z", commit: $head}
  ],
  threads: [
    {
      id: "PRRT_kwDOLr8b2M5f1aQ1", isResolved: true, resolvedBy: "bendrucker", path: "test/rate-limit.test.ts", line: 31,
      comments: [note("priya-k"; "2026-09-20T14:02:11Z"; $opened; "This test sleeps for two real seconds. Fake timers (or passing `now` into `check`) would keep the suite fast.")]
    },
    {
      id: "PRRT_kwDOLr8b2M5f1aQ2", isResolved: true, resolvedBy: "bendrucker", path: "src/middleware/rate-limit.ts", line: 18,
      comments: [
        note("priya-k"; "2026-09-20T14:05:40Z"; $opened; "Typo: `retryAfer`."),
        note("bendrucker"; "2026-09-22T09:31:02Z"; $head; "Fixed, it's `retryAfter` now.")
      ]
    },
    {
      id: "PRRT_kwDOLr8b2M5f1aQ3", isResolved: false, path: "src/routes/orders.ts", line: 18,
      comments: [note("coderabbitai"; "2026-09-21T08:44:57Z"; $opened; "_⚠️ Potential issue_\n\n**`limiter.check()` returns a Promise that is never awaited.**\n\n`result.allowed` is always `undefined` on a pending Promise, so the guard never rejects and the limit is not enforced.\n\n```diff\n-  const result = limiter.check(tenant);\n+  const result = await limiter.check(tenant);\n```") + {bot: true}]
    },
    {
      id: "PRRT_kwDOLr8b2M5f1aQ4", isResolved: false, path: "src/config.ts", line: 6,
      comments: [
        note("mchen"; "2026-09-21T16:20:33Z"; $opened; "Should the limit be configurable per tenant? Enterprise tenants will hit 100/min quickly."),
        note("bendrucker"; "2026-09-21T17:02:48Z"; $opened; "Keeping it global for this PR. Per-tenant limits need the tenant settings table, tracked in #251.")
      ]
    },
    {
      id: "PRRT_kwDOLr8b2M5f1aQ5", isResolved: true, resolvedBy: "bendrucker", path: "src/routes/orders.ts", line: 54,
      comments: [note("mchen"; "2026-09-21T16:31:09Z"; $opened; "Return 429 with a `Retry-After` header here instead of 503. Clients treat 503 as an outage and our SDK retries it immediately.")]
    },
    {
      id: "PRRT_kwDOLr8b2M5f1aQ6", isResolved: false, path: "src/middleware/rate-limit.ts", line: 39,
      comments: [note("mchen"; "2026-09-24T11:12:40Z"; $head; "This is a fixed window, so a tenant can send twice the limit across a window boundary (100 at 0:59, 100 at 1:00). Could this be a sliding window or a token bucket?")]
    }
  ],
  checks: [
    {name: "test", state: "pass", elapsed: "1m12s", link: "https://github.com/acme/api-server/actions/runs/1"},
    {name: "lint", state: "pass", elapsed: "31s", link: "https://github.com/acme/api-server/actions/runs/1"}
  ]
}
JQ
