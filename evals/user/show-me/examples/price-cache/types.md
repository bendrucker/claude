---
fail: []
---
```ts fragment
interface CacheEntry<T> {
  value: T
  expiresAt: number
}

interface SourcePolicy {
  ttlMs: number
}

interface PriceCache {
  basePrice(sku: string): Promise<number>
  rate(from: string, to: string): Promise<number>
  invalidateSku(sku: string): void
}

function createPriceCache(policies: { catalog: SourcePolicy; fx: SourcePolicy }): PriceCache
```

`priceFor` keeps its signature and reads through the cache.
