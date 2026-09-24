---
fail: [call-tree, failure-path]
---
The handler calls updateProduct, which runs validatePatch, saveProduct, and then reindex before purging the CDN.
