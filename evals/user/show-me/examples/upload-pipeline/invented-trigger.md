---
fail: [no-invented-trigger]
---
```mermaid
sequenceDiagram
    participant Browser
    participant API
    participant S3
    participant Queue
    participant Worker

    Browser->>API: POST /uploads (filename, size)
    API->>API: create record (status=pending)
    API-->>Browser: presigned S3 URL + upload id

    Browser->>S3: PUT file (direct upload)
    S3-->>Browser: 200 OK
    S3--)Queue: object-created event

    Queue-)Worker: deliver job
    Worker->>S3: GET original
    Worker->>Worker: generate thumbnail
    Worker->>S3: PUT thumbnail
    Worker->>API: PATCH /uploads/:id (status=ready, thumbnail url)

    loop poll or subscribe
        Browser->>API: GET /uploads/:id
        API-->>Browser: status=ready
    end
```

Two decoupled hops matter here: the browser talks to S3 directly for the raw bytes (API never proxies the file), and the worker learns about new files via the S3 event → queue, not by the API calling it directly. The browser only finds out about completion by asking the API again — either polling `GET /uploads/:id` or, if the API supports it, over a WebSocket/SSE push instead of the loop shown.
