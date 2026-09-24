#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/http src/catalog src/search
cat > src/http/products.ts <<'TS'
import { updateProduct } from "../catalog/update";

export async function handlePut(req: Request, id: string): Promise<Response> {
  const product = await updateProduct(id, await req.json());
  return Response.json(product);
}
TS
cat > src/catalog/update.ts <<'TS'
import { validatePatch } from "./validate";
import { loadProduct, saveProduct } from "./repo";
import { reindex } from "../search/index";
import { markStale } from "../search/stale";
import { purgeCdn } from "./cdn";

export async function updateProduct(id: string, patch: unknown) {
  const changes = validatePatch(patch);
  const product = { ...(await loadProduct(id)), ...changes };
  await saveProduct(product);
  try {
    await reindex(product);
  } catch {
    await markStale(product.id);
  }
  await purgeCdn(`/products/${product.id}`);
  return product;
}
TS
cat > src/catalog/validate.ts <<'TS'
export function validatePatch(patch: unknown): Record<string, unknown> {
  if (typeof patch !== "object" || patch === null) throw new Error("bad patch");
  return patch as Record<string, unknown>;
}
TS
cat > src/catalog/repo.ts <<'TS'
const rows = new Map<string, { id: string }>();
export async function loadProduct(id: string) {
  return rows.get(id) ?? { id };
}
export async function saveProduct(p: { id: string }) {
  rows.set(p.id, p);
}
TS
cat > src/catalog/cdn.ts <<'TS'
export async function purgeCdn(path: string) {}
TS
cat > src/search/index.ts <<'TS'
export async function reindex(product: { id: string }) {}
TS
cat > src/search/stale.ts <<'TS'
export async function markStale(id: string) {}
TS
