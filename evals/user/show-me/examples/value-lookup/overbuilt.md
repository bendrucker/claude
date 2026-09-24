---
fail: [one-block, no-diagram]
---
```ts
formatBytes(1536) // "1.5 KiB"
```

```mermaid
flowchart TD
  A[1536] --> B{>= 1024?} --> C[1.5 KiB]
```
