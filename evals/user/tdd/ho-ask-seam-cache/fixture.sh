#!/usr/bin/env bash
set -euo pipefail
mkdir -p src data
cat > data/catalog.json <<'JSON'
[{ "sku": "tee-blk-m", "name": "Black tee", "priceCents": 2400 }]
JSON
cat > src/catalog.ts <<'TS'
export interface Product {
  sku: string;
  name: string;
  priceCents: number;
}

export async function loadCatalog(path: string): Promise<Product[]> {
  return (await Bun.file(path).json()) as Product[];
}
TS
cat > src/routes.ts <<'TS'
import { loadCatalog } from "./catalog";

export async function productPage(sku: string, catalogPath: string): Promise<Response> {
  const catalog = await loadCatalog(catalogPath);
  const product = catalog.find((p) => p.sku === sku);
  if (!product) return new Response("not found", { status: 404 });
  return Response.json(product);
}
TS
