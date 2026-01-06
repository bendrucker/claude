---
name: parallel-prs
description: Batch-process multiple issues into draft PRs using parallel worktrees. Use when implementing several related issues simultaneously, creating multiple PRs in parallel, or batch-processing a backlog.
allowed-tools: Bash(git:*)
---

# Parallel PRs

Batch-process issues into draft PRs using git worktrees for isolation.

## Constraints

- **Batch size**: 5 issues max per round (larger batches split automatically)
- **No worktree cleanup**: PRs may need iteration after CI feedback
- **Issue linking**: Use `Closes #123` (GitHub) or `Closes ENG-XXX` (Linear) in commit body

## Workflow

1. **Gather issues** - Load `linear` or `github` skill, fetch details, split into batches of 5
2. **Clarify requirements** - Use AskUserQuestion upfront to resolve ambiguities
3. **Plan all issues** - Run planning agents in parallel (verify paths, line numbers)
4. **Create worktrees** - One per issue in `.worktrees/`
5. **Implement in parallel** - Agents commit, push, and write PR body to file
6. **Create PRs** - Parent runs `gh pr create --body-file` for each
7. **Monitor CI** - Dispatch agent to watch for failures across branches

See [workflow.md](workflow.md) for detailed steps.

## Critical: Skill Inheritance

Subagents **cannot** use the Skill tool - skills don't inherit to child agents.

**Implementation agents must**:
- Commit and push changes
- Write PR body to `tmp/{branch}/pr-body.md`
- Return control to parent (NOT create PR)

**Parent agent must**:
- Run `gh pr create --body-file` mechanically
- Implementation agent already wrote the content

See [agents.md](agents.md) for agent configuration.

## Quick Start

```
# Linear issues
/parallel-prs ENG-101 ENG-102 ENG-103

# GitHub issues
/parallel-prs #123 #124 #125
```
