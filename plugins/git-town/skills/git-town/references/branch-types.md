# Branch Types

git-town categorizes branches to determine how they sync and interact. Understanding branch types helps you configure git-town for your workflow.

## Feature Branches

**Default type for new branches.**

- Created with `git town hack` or `git town append`
- Have a parent branch (usually `main` or another feature)
- Sync by rebasing onto parent, then pushing
- Deleted locally after their PR merges

```bash
git town hack my-feature  # Creates a feature branch
```

## Perennial Branches

**Long-lived branches that never get deleted.**

Examples: `main`, `master`, `develop`, `staging`, `production`

- No parent branch
- Sync by pulling from remote (no rebase)
- Never deleted by git-town
- Can be parents for feature branches

Configure during `git town init` or:

```bash
git town config perennial-branches add staging
git town config perennial-branches remove staging
```

## Contribution Branches

**Branches in repos you don't own.**

When you clone someone else's repo and create branches:

- Sync by rebasing onto the tracking branch
- Don't push automatically (you may not have permission)
- Useful for contributing to open source

```bash
git town contribute  # Mark current branch as contribution
```

## Observed Branches

**Branches you watch but don't modify.**

Track branches from other contributors:

- Sync by pulling from remote only
- Never push
- Never deleted

```bash
git town observe  # Mark current branch as observed
git town observe feature-x  # Mark specific branch
```

## Parked Branches

**Branches temporarily excluded from sync.**

When you need to pause work on a branch:

- Skipped during `git town sync --all`
- Not deleted even if remote is gone
- Useful for work-in-progress you'll return to

```bash
git town park           # Park current branch
git town unpark         # Resume syncing
```

## Prototype Branches

**Branches not yet ready to push.**

For experimental work:

- Sync locally (rebase onto parent)
- Don't push to remote
- Useful for trying ideas before sharing

```bash
git town prototype      # Mark as prototype
git town propose        # Automatically un-prototypes and pushes
```

## How Syncing Differs by Type

| Branch Type  | Rebase | Push | Delete After Merge |
|--------------|--------|------|-------------------|
| Feature      | Yes    | Yes  | Yes               |
| Perennial    | No     | Yes  | No                |
| Contribution | Yes    | No   | No                |
| Observed     | No     | No   | No                |
| Parked       | Skip   | Skip | No                |
| Prototype    | Yes    | No   | Yes               |

## Changing Branch Type

Most type commands toggle:

```bash
git town contribute  # Toggle contribution status
git town observe     # Toggle observed status
git town park        # Toggle parked status
git town prototype   # Toggle prototype status
```

## Viewing Branch Configuration

```bash
git town branch     # Show current branch info
git town branches   # Show all branches with types
```

## Configuration Storage

Branch types are stored in git config:

```
git-town-branch.<name>.branchtype = contribution|observed|parked|prototype
```

This travels with the repository when cloned.
