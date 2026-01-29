# Flowchart Reference

## Basic Syntax

```mermaid
flowchart TB
    A[Rectangle] --> B(Rounded)
    B --> C{Diamond}
    C -->|Yes| D[[Subroutine]]
    C -->|No| E[(Database)]
```

## Direction

| Directive | Direction |
|-----------|-----------|
| `TB` / `TD` | Top to bottom |
| `BT` | Bottom to top |
| `LR` | Left to right |
| `RL` | Right to left |

Use `LR` for timelines and processes. Use `TB` for hierarchies and org charts.

## Node Shapes

| Syntax | Shape | Use For |
|--------|-------|---------|
| `[text]` | Rectangle | Actions, processes |
| `(text)` | Rounded | Start/end points |
| `{text}` | Diamond | Decisions |
| `[[text]]` | Subroutine | Function calls |
| `[(text)]` | Cylinder | Databases |
| `((text))` | Circle | Events, triggers |
| `>text]` | Flag | Async signals |
| `{{text}}` | Hexagon | Preparation steps |

## Edge Types

| Syntax | Style |
|--------|-------|
| `-->` | Arrow |
| `---` | Line (no arrow) |
| `-.->`| Dotted arrow |
| `==>` | Thick arrow |
| `--text-->` | Arrow with label |
| `-->|text|` | Arrow with label (alt) |

## Subgraphs

Group related nodes:

```mermaid
flowchart TB
    subgraph auth[Authentication]
        A[Login] --> B[Validate]
        B --> C[Token]
    end

    subgraph api[API Layer]
        D[Request] --> E[Handler]
    end

    C --> D
```

Subgraphs inherit parent direction. Use them for:
- Logical grouping (auth, database, external services)
- Swimlanes (by team or system)
- Phases (input, processing, output)

## Parallel Paths

Show concurrent operations:

```mermaid
flowchart TB
    A[Start] --> B[Fork]
    B --> C[Task 1]
    B --> D[Task 2]
    B --> E[Task 3]
    C --> F[Join]
    D --> F
    E --> F
    F --> G[End]
```

## Decision Trees

```mermaid
flowchart TB
    A[Request] --> B{Authenticated?}
    B -->|Yes| C{Authorized?}
    B -->|No| D[401 Unauthorized]
    C -->|Yes| E[Process]
    C -->|No| F[403 Forbidden]
    E --> G{Success?}
    G -->|Yes| H[200 OK]
    G -->|No| I[500 Error]
```

## Styling

Define classes and apply them:

```mermaid
flowchart LR
    classDef default fill:#fff,stroke:#333
    classDef highlight fill:#ff0,stroke:#f00,stroke-width:2px

    A[Normal] --> B[Highlighted]:::highlight
```

## Layout Tips

- Minimize edge crossings by ordering nodes logically
- Use subgraphs to reduce visual complexity
- Keep labels short—expand in surrounding text
- For wide diagrams, consider `TB` instead of `LR`
