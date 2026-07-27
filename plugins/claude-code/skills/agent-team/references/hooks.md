# Team Quality Gate Hooks

Two hook events enforce quality when teammates finish work or complete tasks:

- **TeammateIdle**: runs when a teammate is about to go idle. Block to verify output before letting them stop (tests pass, lint clean, deliverables exist).
- **TaskCompleted**: runs when a task is being marked complete. Block to enforce acceptance criteria before allowing the status change.

```json
{
  "hooks": {
    "TeammateIdle": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun ./hooks/check-teammate-output.ts"
          }
        ]
      }
    ]
  }
}
```

## Exit Code Behavior

| Code | Effect |
|---|---|
| 0 | Allow (teammate goes idle / task completes) |
| 2 | Block with feedback (stdout sent back to the agent) |
| Other | Hook error, operation continues |
