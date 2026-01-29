# Valid Mermaid Fixtures

## Flowchart - Basic

```mermaid
flowchart LR
    A[Start] --> B{Decision}
    B -->|Yes| C[Action]
    B -->|No| D[End]
    C --> D
```

## Flowchart - Subgraph

```mermaid
flowchart TB
    subgraph auth[Authentication]
        A[Login] --> B[Validate]
        B --> C[Token]
    end

    subgraph api[API Layer]
        D[Request] --> E[Handler]
        E --> F[Response]
    end

    C --> D
```

## Flowchart - Styled

```mermaid
flowchart LR
    classDef error fill:#fee,stroke:#c00
    classDef success fill:#efe,stroke:#0a0

    A[Request] --> B{Valid?}
    B -->|Yes| C[Process]:::success
    B -->|No| D[Error]:::error
```

## Sequence - Basic

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    participant D as Database

    C->>S: Request
    S->>D: Query
    D-->>S: Result
    S-->>C: Response
```

## Sequence - Alt

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server

    C->>+S: Request
    alt Valid
        S-->>C: 200 OK
    else Invalid
        S-->>C: 400 Bad Request
    end
    deactivate S
```

## Sequence - Loop

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server

    loop Retry 3 times
        C->>S: Request
        alt Success
            S-->>C: Response
        else Failure
            S-->>C: Error
        end
    end
```

## Sequence - Notes

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server

    Note over C,S: TLS Handshake
    C->>S: Request
    Note right of S: Validate token
    S-->>C: Response
```

## State - Basic

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Processing: start
    Processing --> Complete: success
    Processing --> Failed: error
    Complete --> [*]
    Failed --> Idle: retry
```

## State - Composite

```mermaid
stateDiagram-v2
    [*] --> Active

    state Active {
        [*] --> Idle
        Idle --> Working: task
        Working --> Idle: done
    }

    Active --> Suspended: pause
    Suspended --> Active: resume
    Active --> [*]: shutdown
```

## ER - Basic

```mermaid
erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : "appears in"
```

## ER - Attributes

```mermaid
erDiagram
    USER {
        int id PK
        string username UK
        string email UK
        string password_hash
        datetime created_at
    }

    POST {
        int id PK
        int author_id FK
        string title
        text content
        datetime published_at
    }

    USER ||--o{ POST : writes
```
