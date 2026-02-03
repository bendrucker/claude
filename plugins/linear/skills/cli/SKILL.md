---
name: cli
description: Linear CLI for issue management from the terminal. Use when creating branches from issues, viewing issue details, or working with Linear via command line.
allowed-tools: [Bash(linear:*)]
user-invocable: false
---

# Linear CLI

The `linear` command manages Linear issues, teams, projects, and milestones.

## Key Patterns

Commands that manage resources under issues use nested subcommands:

```bash
linear issue comment add --body "text"      # not `linear comment add`
linear issue comment update <id> --body "text"
```

Use flags, not positional arguments:

```bash
linear issue create -t "Title" -d "Description"
linear issue comment add --body "text"      # body is --body, not positional
```

## Issues

```bash
linear issue view            # view current issue (from branch)
linear issue view ABC-123    # view specific issue
linear issue view -w         # open in browser
linear issue list            # list unstarted issues
linear issue start ABC-123   # create branch and start issue
linear issue create -t "Title" -d "Description"
linear issue pr              # create GitHub PR from issue
```

## Issue Comments

```bash
linear issue comment add --body "Comment text"
linear issue comment add ABC-123 --body "Comment on specific issue"
linear issue comment update <comment-id> --body "Updated text"
linear issue comment list
```

## Teams

```bash
linear team list      # list teams
linear team members   # list members
```

## Milestones

```bash
linear milestone list --project <id>
linear milestone view <id>
linear milestone create --project <id> --name "Q1" --target-date "2026-03-31"
linear milestone update <id> --name "New name"
linear milestone update <id> --target-date "2026-03-31"
linear milestone update <id> --description "Description text"
```
