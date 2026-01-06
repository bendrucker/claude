# Agent Configuration

## Planning Agent (Plan)

**Outputs**:
- Verified file paths
- Current line numbers for modifications
- Conflict analysis with other issues in batch
- Test commands to validate changes

## Implementation Agent (general-purpose)

**Does**:
- Work within assigned worktree
- Commit with `Closes {issue-ref}` in body
- Push branch to remote
- Write PR body to `tmp/{branch}/pr-body.md`

**Does not**:
- Create PRs (parent does this)
- Modify issues in Linear/GitHub
- Work outside worktree directory

## CI Monitor Agent (github-actions-monitor)

**Outputs**:
- Pass/fail status per PR
- Failure logs for debugging

## Parallel Execution

```
Task(subagent_type: general-purpose, prompt: "...", run_in_background: true) → agent_1
Task(subagent_type: general-purpose, prompt: "...", run_in_background: true) → agent_2

TaskOutput(task_id: agent_1, block: true)
TaskOutput(task_id: agent_2, block: true)
```
