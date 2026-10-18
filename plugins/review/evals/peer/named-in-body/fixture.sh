#!/usr/bin/env bash
set -euo pipefail
stubs="$(dirname "$0")/../../../../../packages/eval-stubs"
bash "$stubs/install.sh"
source "$stubs/preamble.sh" https://github.com/org/billing.git

mkdir -p src
cat > src/invoices.ts <<'TS'
export interface Invoice {
  id: string;
  total: number;
}

export function listInvoices(all: Invoice[]): Invoice[] {
  return all;
}
TS
BASE=$(commit "2026-09-01T10:00:00Z" "invoices: list endpoint")

git switch -qc invoice-pages
cat > src/invoices.ts <<'TS'
export interface Invoice {
  id: string;
  total: number;
}

export interface Page {
  invoices: Invoice[];
  page: number;
  pages: number;
}

export function listInvoices(all: Invoice[], page = 0, size = 25): Page {
  const start = page * size;
  return {
    invoices: all.slice(start, size),
    page,
    pages: Math.ceil(all.length / size),
  };
}
TS
commit_as "Priya Raman" praman@example.com "2026-09-04T15:00:00Z" $'invoices: paginate the list (Priya)\n\nPriya\'s first pass at paging; Marcus paired on the page math.\n\nCo-authored-by: Marcus Lee <mlee@example.com>' >/dev/null
cat >> src/invoices.ts <<'TS'

export const MAX_PAGE_SIZE = 100;
TS
HEAD_SHA=$(commit_as "Priya Raman" praman@example.com "2026-09-04T16:00:00Z" "invoices: cap page size (Priya, per Marcus)")

jq -n --arg root "$PWD" --arg base "$BASE" --arg head "$HEAD_SHA" -f /dev/stdin > "$HOME/.eval-stubs/meta.json" <<'JQ'
{
  root: $root,
  repo: "org/billing",
  viewer: "bendrucker",
  base: $base,
  head: $head,
  pull: {
    number: 58,
    title: "Priya's invoice pagination",
    author: "praman",
    headRefName: "invoice-pages",
    createdAt: "2026-09-04T16:05:00Z",
    body: "**Author:** Priya Raman (@praman)\n**Pairing partner:** Marcus Lee (@mlee)\n\nPriya here! This is my first PR on billing, so please be picky. I added `page` and `size` to `listInvoices` so the dashboard stops loading every invoice at once. Marcus helped me with the page math.\n\n- [x] Paged the list\n- [ ] Tests (Priya will add once the shape is agreed)\n\nThanks, Priya"
  },
  reviews: [],
  threads: []
}
JQ
