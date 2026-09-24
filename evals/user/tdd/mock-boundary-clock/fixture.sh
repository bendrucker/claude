#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/token.ts <<'TS'
export interface Token {
  value: string;
  /** Expiry as epoch milliseconds. */
  expiresAt: number;
}

export function isExpired(token: Token): boolean {
  return Date.now() >= token.expiresAt;
}
TS
