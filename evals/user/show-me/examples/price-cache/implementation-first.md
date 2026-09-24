---
fail: [types-first, signatures]
---
```ts
const cache = new Map<string, { value: number; at: number }>();

export async function cachedBase(sku: string) {
  const hit = cache.get(sku);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const value = await basePrice(sku);
  cache.set(sku, { value, at: Date.now() });
  return value;
}
```

Each source gets its own TTL, and invalidate deletes the key.
