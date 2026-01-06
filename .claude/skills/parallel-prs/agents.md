# Agent Configuration

## Why Skill Inheritance Fails

The Skill tool requires context from the parent conversation:
- Skill descriptions for matching
- Skill file paths
- User's skill customizations

Subagents spawned via Task tool start fresh without this context. Attempting to use `/pr` in a subagent will fail silently or produce malformed PRs.

## Agent Responsibilities

### Planning Agent (Plan)

**Purpose**: Validate implementation approach before code changes

**Outputs**:
- Verified file paths
- Current line numbers for modifications
- Conflict analysis with other issues in batch
- Test commands to validate changes

**Why planning first**: Implementations run in parallel. Planning catches:
- Outdated line numbers from stale issue descriptions
- Files that moved or were renamed
- Potential merge conflicts between issues

### Implementation Agent (general-purpose)

**Purpose**: Make code changes, commit, push, write PR body

**Boundaries**:
- Works only within assigned worktree
- Commits with `Closes {issue-ref}` in body
- Pushes branch to remote
- Writes PR body to `tmp/{branch}/pr-body.md`
- Returns after writing PR body

**Explicitly forbidden**:
- Creating PRs (parent does this mechanically)
- Modifying issues in Linear/GitHub
- Working outside worktree directory

### CI Monitor Agent (github-actions-monitor)

**Purpose**: Watch for CI failures across all branches

**Triggers**: After all PRs created

**Outputs**:
- Pass/fail status per PR
- Failure logs for debugging
- Suggested fixes if patterns detected

## Parallel Execution

Use Task tool with `run_in_background: true` for parallel work:

```
# Launch all implementations in parallel
Task(subagent_type: general-purpose, prompt: "...", run_in_background: true) → agent_1
Task(subagent_type: general-purpose, prompt: "...", run_in_background: true) → agent_2

# Wait for completion
TaskOutput(task_id: agent_1, block: true)
TaskOutput(task_id: agent_2, block: true)
```

Planning can also run in parallel since plans are independent.
