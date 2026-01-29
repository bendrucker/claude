# Invalid Mermaid Fixtures

## Empty Block

```mermaid
```

## Flowchart - Unclosed Bracket

```mermaid
flowchart LR
    A[Start --> B[End]
```

## Flowchart - Invalid Direction

```mermaid
flowchart XY
    A --> B
```

## Flowchart - Missing Arrow

```mermaid
flowchart LR
    A B C
```

## Sequence - Unclosed Alt

```mermaid
sequenceDiagram
    participant A
    participant B

    A->>B: Request
    alt Success
        B-->>A: Response
```

## Sequence - Invalid Arrow

```mermaid
sequenceDiagram
    participant A
    participant B

    A=>B: Request
```

## State - Unclosed Block

```mermaid
stateDiagram-v2
    state Active {
        [*] --> Idle
```

## ER - Invalid Cardinality

```mermaid
erDiagram
    USER **--** POST : writes
```
