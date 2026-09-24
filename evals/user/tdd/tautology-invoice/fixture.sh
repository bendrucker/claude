#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/invoice.ts <<'TS'
export interface Line {
  description: string;
  unitCents: number;
  quantity: number;
}

export const TAX_RATE = 0.08;

export function subtotal(lines: Line[]): number {
  return lines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0);
}

export function total(lines: Line[]): number {
  return Math.round(subtotal(lines) * (1 + TAX_RATE));
}
TS
