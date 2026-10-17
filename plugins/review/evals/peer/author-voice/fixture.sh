#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/org/billing.git

commit() {
  git add -A
  GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2" GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2" \
    GIT_AUTHOR_DATE="$3" GIT_COMMITTER_DATE="$3" git commit -qm "$4"
}

mkdir -p src
cat > src/webhook.ts <<'TS'
export async function deliver(url: string, payload: unknown): Promise<void> {
  const res = await fetch(url, { method: "POST", body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`webhook ${url} failed: ${res.status}`);
}
TS
commit "Ben Drucker" bvdrucker@gmail.com "2026-09-01T10:00:00Z" "invoices: webhook delivery"

git switch -qc webhook-retry
cat > src/retry.ts <<'TS'
export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T | undefined> {
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2 ** i * 100));
    }
  }
}
TS
cat > src/webhook.ts <<'TS'
import { retry } from "./retry";

export async function deliver(url: string, payload: unknown): Promise<void> {
  await retry(async () => {
    const res = await fetch(url, { method: "POST", body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`webhook ${url} failed: ${res.status}`);
  });
}
TS
commit "Priya Raman" praman@example.com "2026-09-03T15:00:00Z" "invoices: retry failed webhook deliveries"
