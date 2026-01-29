# Sequence Diagram Reference

## Basic Syntax

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

## Participants

Declare participants to control ordering:

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant A as API
    participant D as Database
```

Order participants left-to-right following data flow. Aliases keep labels concise.

## Message Types

| Syntax | Meaning |
|--------|---------|
| `->>` | Synchronous request |
| `-->>` | Async/return response |
| `--)` | Async message (no wait) |
| `-x` | Lost message |
| `--x` | Lost async message |

## Activations

Show when participants are active:

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server

    C->>+S: Request
    S->>S: Process
    S-->>-C: Response
```

Use `+` to activate, `-` to deactivate. Activations can nest.

## Control Flow

### Alt/Else (Conditional)

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server

    C->>S: Request
    alt Valid
        S-->>C: 200 OK
    else Invalid
        S-->>C: 400 Bad Request
    end
```

### Opt (Optional)

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server

    C->>S: Request
    opt Cache Hit
        S-->>C: Cached Response
    end
```

### Loop

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server

    loop Retry 3 times
        C->>S: Request
        alt Success
            S-->>C: Response
        end
    end
```

### Parallel

```mermaid
sequenceDiagram
    participant C as Client
    participant A as Service A
    participant B as Service B

    par
        C->>A: Request A
    and
        C->>B: Request B
    end
    A-->>C: Response A
    B-->>C: Response B
```

## Notes

Add context without cluttering the flow:

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server

    Note over C,S: TLS Handshake
    C->>S: Request
    Note right of S: Validate token
    S-->>C: Response
```

## Example: Tool Approval Protocol

From pydantic-ai tool approval flow:

```mermaid
sequenceDiagram
    participant Model
    participant Server
    participant Client

    Model->>Server: tool call
    Server->>Client: tool-input-start
    Server->>Client: tool-input-available
    Server->>Client: tool-approval-request

    Note over Client: User approves/denies

    Client->>Server: approval response (next request)

    alt Approved
        Server->>Server: Execute tool
        Server->>Client: tool-output-available
    else Denied
        Server->>Client: tool-output-denied
        Server->>Model: denial info
    end
```

## Best Practices

- Order participants by data flow (typically left-to-right)
- Use aliases to keep participant names short
- Use `Note over` for context that spans participants
- Use `alt`/`else` for branching outcomes
- Keep message labels concise—detail in prose
- Activations show processing time visually
