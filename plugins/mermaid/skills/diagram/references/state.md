# State Diagram Reference

## Basic Syntax

Use `stateDiagram-v2` for the latest features:

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Processing: start
    Processing --> Complete: success
    Processing --> Failed: error
    Complete --> [*]
    Failed --> Idle: retry
```

## States

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

- **event**: What triggers the transition
- **[guard]**: Condition that must be true
- **/ action**: Side effect of the transition

## Composite States

Nest states for complex workflows:

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

Parallel state regions:

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

## Choice (Decision)

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

## Example: Order Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Pending

    Pending --> Confirmed: payment_received
    Pending --> Cancelled: timeout

    state Confirmed {
        [*] --> Preparing
        Preparing --> Ready: packed
        Ready --> [*]
    }

    Confirmed --> Shipped: dispatch
    Shipped --> Delivered: arrive
    Delivered --> [*]

    Cancelled --> [*]
```

## Best Practices

- Always use `[*]` for clear entry and exit points
- Group related states with composite states
- Use guards `[condition]` for conditional transitions
- Keep state names short, use descriptions for detail
- Order states to minimize arrow crossings
