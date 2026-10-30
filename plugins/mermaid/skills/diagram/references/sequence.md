# Sequence Diagram Reference

## Participants

Declare participants in data-flow order to set their left-to-right position. Aliases shorten labels.

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

## Message Types

| Syntax | Meaning |
|--------|---------|
| `->>` | Synchronous request |
| `-->>` | Async/return response |
| `--)` | Async message (no wait) |
| `-x` | Lost message |
| `--x` | Lost async message |

## Activations

`+` activates and `-` deactivates. Activations can nest.

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server

    C->>+S: Request
    S->>S: Process
    S-->>-C: Response
```

## Control Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant A as Service A
    participant B as Service B

    alt Valid
        C->>A: Request
    else Invalid
        A-->>C: 400 Bad Request
    end

    opt Cache Hit
        A-->>C: Cached Response
    end

    loop Retry 3 times
        C->>A: Request
    end

    par
        C->>A: Request A
    and
        C->>B: Request B
    end
```

## Notes

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server

    Note over C,S: TLS Handshake
    C->>S: Request
    Note right of S: Validate token
    S-->>C: Response
```
