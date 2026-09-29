#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

# The session's zsh reads $HOME/.zshenv, so the stub gh shadows the real one.
stub="$HOME/.local/stub"
mkdir -p "$stub"
cp "$here/gh.ts" "$stub/gh"
chmod +x "$stub/gh"
echo "export PATH=\"$stub:\$PATH\"" >> "$HOME/.zshenv"

git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/acme/api-server.git

commit() {
  GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -qam "$2"
}

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
git add -A
commit "2026-09-18T10:00:00Z" "api-server: orders endpoint"
git update-ref refs/remotes/origin/main HEAD

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
git add -A
commit "2026-09-19T15:00:00Z" "orders: rate-limit order creation per tenant"

sed -i.bak 's/export const retryAfer = retryAfterSeconds;/export const retryAfter = retryAfterSeconds;/' src/middleware/rate-limit.ts
rm src/middleware/rate-limit.ts.bak
commit "2026-09-22T09:10:00Z" "rate-limit: fix the retryAfter export name"

sed -i.bak 's/  const result = limiter.check(tenant);/  const result = await limiter.check(tenant);/' src/routes/orders.ts
rm src/routes/orders.ts.bak
commit "2026-09-22T09:20:00Z" "orders: await the limiter check"
