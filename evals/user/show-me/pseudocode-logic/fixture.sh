#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/limits
cat > src/limits/bucket.ts <<'TS'
import { clock } from "./clock";

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();
const CAPACITY = 20;
const REFILL_PER_SECOND = 5;

export function allow(key: string, cost = 1): boolean {
  const now = clock.now();
  const bucket = buckets.get(key) ?? { tokens: CAPACITY, updatedAt: now };
  const elapsed = (now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(CAPACITY, bucket.tokens + elapsed * REFILL_PER_SECOND);
  bucket.updatedAt = now;
  if (bucket.tokens < cost) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.tokens -= cost;
  buckets.set(key, bucket);
  return true;
}
TS
cat > src/limits/clock.ts <<'TS'
export const clock = { now: () => Date.now() };
TS
cat > src/limits/middleware.ts <<'TS'
import { allow } from "./bucket";

export function rateLimit(req: Request): Response | undefined {
  const key = req.headers.get("x-api-key") ?? "anonymous";
  const cost = req.method === "GET" ? 1 : 3;
  if (!allow(key, cost)) return new Response("slow down", { status: 429 });
}
TS
