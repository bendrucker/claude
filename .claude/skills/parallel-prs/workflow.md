# Workflow

## Gather Issues

Parse arguments as issue identifiers:
- **Linear**: `ENG-101 ENG-102 ENG-103`
- **GitHub**: `#123 #124 #125` or `owner/repo#123`

Load the appropriate skill (`linear` or `github`) based on issue format.

Validate:
- All issues exist and are accessible
- Split into batches of 5 if more issues provided
- Process each batch sequentially (all PRs from batch 1 before starting batch 2)

## Clarify Requirements

Before planning, use AskUserQuestion to resolve ambiguities upfront:
- Implementation approach choices
- Scope boundaries (what's in/out)
- Dependencies between issues

Gathering requirements early enables autonomous execution later.

## Plan All Issues

Launch planning agents in parallel using Task tool:

```
subagent_type: Plan
prompt: |
  Plan implementation for issue {issue-ref}: {title}

  {description}

  Verify:
  - File paths exist
  - Line numbers are current
  - Proposed changes don't conflict

  Return a structured plan with:
  - Files to modify
  - Key changes per file
  - Test commands to run
```

Wait for all plans before proceeding. Review for conflicts between issues.

## Create Worktrees

For each issue, create an isolated worktree:

```bash
git worktree add .worktrees/{slug} -b {branch-name} main
```

Branch naming: `{type}/{issue-id}-{slug}` (e.g., `fix/eng-101-timeout-handling`)

## Implement in Parallel

Launch implementation agents with explicit boundaries:

```
subagent_type: general-purpose
prompt: |
  Working directory: {repo}/.worktrees/{slug}

  Implement: {plan}

  After implementation:
  1. Commit with message including "Closes {issue-ref}"
  2. Push to remote
  3. Write PR body to tmp/{branch}/pr-body.md following pull-request skill format:
     - Title line (first line)
     - 1-3 sentence summary
     - ## sections as needed (Issue, Changes, Testing)
  4. Return - DO NOT create the PR itself

  DO NOT use Skill tool (not available in subagents)
```

## Create PRs

After all implementations complete, create PRs mechanically:

```bash
gh pr create --title "$(head -1 tmp/{branch}/pr-body.md)" \
  --body-file tmp/{branch}/pr-body.md \
  --head {branch}
```

The implementation agent wrote the content; parent just executes the command.

## Monitor CI

After all PRs created, launch CI monitoring agent:

```
subagent_type: github-actions-monitor
prompt: |
  Monitor GitHub Actions for these PRs:
  - PR #123 (ENG-101)
  - PR #124 (ENG-102)
  - PR #125 (ENG-103)

  Report any failures with logs.
```
