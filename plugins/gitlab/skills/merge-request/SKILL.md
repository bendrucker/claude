---
name: gitlab:merge-request
description: Working with GitLab merge requests via glab. Use when creating, updating, reviewing, or merging MRs.
---
# Merge Requests

Working with GitLab merge requests via `glab mr`.

## Key Commands

```bash
glab mr create --fill      # Create from commits (push branch first!)
glab mr list               # List MRs
glab mr view               # View current branch's MR
glab mr checkout <id>      # Check out MR branch
glab mr merge              # Merge current branch's MR
```

Use `glab mr --help` and `glab mr <command> --help` for full options.

## Patterns

**Always push before creating:**
```bash
git push -u origin feature-branch && glab mr create --fill
```

**Draft MRs:** Use `--draft` to prevent accidental merges.

**Auto-fill vs custom:** `--fill` auto-populates from commits but cannot combine with `--title`/`--description`. Choose one approach.

**Body from file:** No `--body-file` flag; use `--description "$(cat file.md)"`.

**Username resolution:** Flags like `--reviewer` and `--assignee` require exact usernames. Invalid names are silently ignored. Look up users first:

```bash
glab api projects/:id/members/all --paginate | jq '.[] | select(.name | test("<name>"; "i")) | {name, username}'
```

## Blocking

Prevent an MR from merging until another MR merges first. Uses the REST API directly since `glab mr` has no blocking subcommand.

```bash
# Block MR !10 until MR !5 merges
glab api projects/:id/merge_requests/10/blocks -X POST -f blocking_merge_request_iid=5

# List blocks on an MR
glab api projects/:id/merge_requests/10/blocks

# Remove a block
glab api projects/:id/merge_requests/10/blocks/<block-id> -X DELETE
```

## Stacking

`glab stack` manages stacked diffs—small changes that build on each other. See [stack.md](stack.md).

## Reference Files

- [stack.md](stack.md) - Stacked diff workflow
