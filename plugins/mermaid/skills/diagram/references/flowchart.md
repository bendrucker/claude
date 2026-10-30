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

Use `LR` for timelines and processes. Use `TB` for hierarchies and for diagrams too wide for `LR`.

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
| `-->\|text\|` | Arrow with label (alt) |

## Subgraphs

Subgraphs inherit the parent direction. Use them to group by component, team, or phase.

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

## Styling

```mermaid
flowchart LR
    classDef default fill:#fff,stroke:#333
    classDef highlight fill:#ff0,stroke:#f00,stroke-width:2px

    A[Normal] --> B[Highlighted]:::highlight
```
