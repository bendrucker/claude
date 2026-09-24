---
fail: []
---
```text
handlePut                       src/http/products.ts
  updateProduct                 src/catalog/update.ts
    validatePatch
    loadProduct
    saveProduct
    reindex
      on failure: markStale
    purgeCdn
```

A reindex failure never fails the request. The product is marked stale and the CDN still gets purged.
