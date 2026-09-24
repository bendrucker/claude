#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src
cat > package.json <<'JSON'
{ "name": "api", "type": "module" }
JSON
cat > src/pool.ts <<'TS'
export interface PoolOptions {
  max: number;
  acquireTimeoutMs: number;
}

export const defaults: PoolOptions = { max: 10, acquireTimeoutMs: 30_000 };

export class Pool<T> {
  private idle: T[] = [];
  private busy = 0;
  private waiters: ((conn: T) => void)[] = [];

  constructor(
    private create: () => Promise<T>,
    private options: PoolOptions = defaults,
  ) {}

  async acquire(): Promise<T> {
    const conn = this.idle.pop();
    if (conn !== undefined) {
      this.busy++;
      return conn;
    }
    if (this.busy < this.options.max) {
      this.busy++;
      return this.create();
    }
    console.warn("WARN pool exhausted, queueing request");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("acquire timed out")), this.options.acquireTimeoutMs);
      this.waiters.push((c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
  }

  release(conn: T): void {
    const next = this.waiters.shift();
    if (next !== undefined) return next(conn);
    this.busy--;
    this.idle.push(conn);
  }
}
TS
git add -A && git commit -qm "api: connection pool"
