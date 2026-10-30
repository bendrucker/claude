# State Diagram Reference

## Basic Syntax

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Processing: start
    Processing --> Complete: success
    Processing --> Failed: error
    Complete --> [*]
    Failed --> Idle: retry
```

| Syntax | Meaning |
|--------|---------|
| `[*]` | Start or end state |
| `StateName` | Simple state |
| `StateName: Description` | State with description |

## Transitions

```mermaid
stateDiagram-v2
    A --> B: event
    B --> C: event [guard]
    C --> D: event / action
```

## Composite States

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

## Forks and Joins

```mermaid
stateDiagram-v2
    [*] --> Fork
    state Fork <<fork>>
    Fork --> TaskA
    Fork --> TaskB

    state Join <<join>>
    TaskA --> Join
    TaskB --> Join
    Join --> Complete
    Complete --> [*]
```

## Choice

```mermaid
stateDiagram-v2
    [*] --> Check
    state Check <<choice>>
    Check --> Valid: [valid]
    Check --> Invalid: [invalid]
    Valid --> [*]
    Invalid --> [*]
```

## Notes

```mermaid
stateDiagram-v2
    State1: Processing
    note right of State1
        This state handles
        incoming requests
    end note
```
