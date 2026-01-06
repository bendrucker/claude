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
- Commit and push changes
- Write PR body to `tmp/{branch}/pr-body.md` with issue linking

**Does not**:
- Create PRs (parent does this)
- Modify issues directly
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
