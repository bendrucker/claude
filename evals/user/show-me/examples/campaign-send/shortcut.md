---
fail: [diagram-parties, no-invented-hop]
---
```mermaid
sequenceDiagram
    Admin->>API: send
    API->>Worker: batches
    Worker->>API: progress
    API-->>Admin: SSE
```
