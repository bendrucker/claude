# Planning

## Alternatives to PRs

Consider whether a pull request is the right approach:

- **Comment for clarification** - Only if I'm not the author, and only after consulting me
- **Comment that issue is resolved** - Based on searching related issues/code, confirm with me first
- **Rewrite the issue** - Only if I'm the author
- **Add interpretation notes** - Comment with my interpretation

## Creating a Plan

If we're working on a PR:

1. Devise a plan and break it into tasks
2. Ask for any additional context needed (but proceed if issue provides enough)
3. Emphasize high-level interfaces: packages, endpoints, interfaces, tables
4. Summarize planned changes: files, classes, functions, patterns
5. Identify automated validation: tests, linter commands
6. Find ways to make small isolated changes before larger ones
7. Ask me to review the plan
8. Save approved plan to `tmp/PLAN.md`

## Execution

- Execute tasks autonomously. I'll interrupt if needed.
- Review changes against all issue requirements before finishing.
- Note any requirements not implemented exactly as described.
- Create branch with concise descriptive name.
- Commit with concise message emphasizing the diff, not the plan.
- Push and create PR following the `pull-request` skill.
