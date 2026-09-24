---
fail: [one-block, no-diagram]
---
```text
"Hello, World!" → "hello, world!" → "hello-world-" → "hello-world"
```

```mermaid
flowchart LR
  A[lowercase] --> B[replace runs] --> C[trim]
```
