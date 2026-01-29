# Stacked Changes Workflow

Stacked branches let you build dependent changes while earlier work is still in review. Each branch becomes a PR targeting its parent.

## Creating Stacks

### Append

Create a child branch from the current branch:

```bash
git town append child-name
```

### Prepend

Insert a branch between current and its parent:

```bash
git town prepend base-name
```

Useful when you realize earlier work should be split out.

## Navigating Stacks

```bash
git town up       # Move to child branch
git town down     # Move to parent branch
git town switch   # Interactive picker showing hierarchy
```

## Syncing Stacks

```bash
git town sync           # Current branch and ancestors only
git town sync --stack   # Current branch and all descendants
git town sync --all     # Every branch in the repository
```

## Proposing Stacked PRs

```bash
git town propose          # PR for current branch
git town propose --stack  # PRs for current branch and all descendants
```

## Shipping Order

Ship branches bottom-first. When a parent merges, run `git town sync` - children rebase onto the new parent and PRs retarget automatically.

Example: `main → A → B → C`, after `A` merges and sync: `main → B → C`

## Restructuring Stacks

```bash
git town set-parent new-parent  # Move to different parent
git town detach                 # Make direct child of main
git town swap                   # Swap with parent (experimental)
git town merge                  # Merge current into parent
```

## Example: Full Stack Workflow

```bash
# Start the stack
git town hack auth-types
# ... add type definitions ...
git commit -m "Add authentication types"

# Build on types
git town append auth-service
# ... implement service ...
git commit -m "Add authentication service"

# Build on service
git town append auth-ui
# ... implement UI ...
git commit -m "Add login UI"

# Sync and propose everything
git town sync --stack
git town propose --stack

# After auth-types PR merges
git town sync --stack
# auth-service PR now targets main

# After auth-service PR merges
git town sync --stack
# auth-ui PR now targets main
```
