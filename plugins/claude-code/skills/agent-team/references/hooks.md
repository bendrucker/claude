# Team Quality Gate Hooks

Two hook types enforce quality when teammates finish work or complete tasks.

## TeammateIdle

Runs when a teammate is about to go idle. Exit with code 2 to send feedback and keep the teammate working.

Use this to verify a teammate's output before letting them stop — check that tests pass, lint is clean, or deliverables exist.

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

## TaskCompleted

Runs when a task is being marked complete. Exit with code 2 to prevent completion and send feedback.

Use this to enforce acceptance criteria — verify the task deliverable matches expectations before allowing the status change.

```json
{
  "hooks": {
    "TaskCompleted": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun ./hooks/validate-task.ts"
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
