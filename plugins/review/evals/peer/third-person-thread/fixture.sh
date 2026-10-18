#!/usr/bin/env bash
set -euo pipefail
stubs="$(dirname "$0")/../../../../../packages/eval-stubs"
bash "$stubs/install.sh"
source "$stubs/preamble.sh" https://github.com/org/billing.git

mkdir -p src
cat > src/rates.ts <<'TS'
export async function fetchRate(currency: string): Promise<number> {
  const res = await fetch(`https://rates.internal/v1/${currency}`);
  const body = (await res.json()) as { rate: number };
  return body.rate;
}
TS
BASE=$(commit "2026-09-01T10:00:00Z" "rates: fetch exchange rates")

git switch -qc rate-cache
cat > src/rates.ts <<'TS'
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { rate: number; at: number }>();

function isExpired(entry: { at: number }): boolean {
  return Date.now() - entry.at < TTL_MS;
}

export async function fetchRate(currency: string): Promise<number> {
  const hit = cache.get(currency);
  if (hit && !isExpired(hit)) return hit.rate;
  const res = await fetch(`https://rates.internal/v1/${currency}`);
  const body = (await res.json()) as { rate: number };
  cache.set(currency, { rate: body.rate, at: Date.now() });
  return body.rate;
}
TS
HEAD_SHA=$(commit_as "Priya Raman" praman@example.com "2026-09-05T15:00:00Z" "rates: cache exchange rates for five minutes")

jq -n --arg root "$PWD" --arg base "$BASE" --arg head "$HEAD_SHA" -f /dev/stdin > "$HOME/.eval-stubs/meta.json" <<'JQ'
{
  root: $root,
  repo: "org/billing",
  viewer: "bendrucker",
  base: $base,
  head: $head,
  pull: {
    number: 61,
    title: "rates: cache exchange rates",
    author: "praman",
    headRefName: "rate-cache",
    createdAt: "2026-09-05T15:05:00Z",
    body: "Caches each currency's rate for five minutes so invoice rendering stops hitting the rates service per line item."
  },
  reviews: [
    { id: 4101, author: "mlee", state: "COMMENTED", submittedAt: "2026-09-05T17:00:00Z", commit: $head, body: "Priya's approach looks reasonable to me. She should probably add a test for the cache, and @bendrucker can you sanity-check the TTL logic and tell Priya what she's missing? She's new to this module." }
  ],
  threads: [
    {
      id: "PRRT_kwDObill01", isResolved: false, path: "src/rates.ts", line: 1,
      comments: [
        { author: "mlee", createdAt: "2026-09-05T16:55:00Z", commit: $head, body: "Priya picked five minutes here. Does finance know? She might want to make this configurable." }
      ]
    }
  ]
}
JQ
