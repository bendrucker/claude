# Stacked Changes Workflow

Stacked branches let you build dependent changes while earlier work is still in review. Each branch becomes a PR, and git-town manages the parent-child relationships.

## When to Use Stacks

**Use stacks when:**
- A feature naturally decomposes into reviewable chunks
- You want to unblock yourself while waiting for review
- Changes build logically on each other

**Use independent branches when:**
- Features are unrelated
- You want PRs to merge in any order
- Reviewers differ between changes

## Creating Stacks

### Append (Most Common)

Create a child branch from the current branch:

```bash
git town append child-name
```

The new branch:
- Starts from your current HEAD
- Has the current branch as its parent
- Will receive changes when the parent syncs

### Prepend

Insert a branch between current and its parent:

```bash
git town prepend base-name
```

Useful when you realize earlier work should be split out.

### From Scratch

Build a complete stack:

```bash
git town hack feature-base
# ... implement base functionality ...
git commit -m "Add base feature"

git town append feature-api
# ... implement API layer ...
git commit -m "Add API endpoints"

git town append feature-ui
# ... implement UI ...
git commit -m "Add UI components"
```

## Navigating Stacks

```bash
git town up       # Move to child branch
git town down     # Move to parent branch
git town switch   # Interactive picker showing hierarchy
```

## Syncing Stacks

### Sync Current Branch Only

```bash
git town sync
```

Syncs the current branch and its ancestors, but not children.

### Sync Entire Stack

```bash
git town sync --stack
```

Syncs the current branch and all descendants. Changes cascade down the stack.

### Sync All Branches

```bash
git town sync --all
```

Syncs every branch in the repository.

## Proposing Stacked PRs

### Single PR

```bash
git town propose
```

Creates a PR for the current branch, targeting its parent.

### All Stack PRs

```bash
git town propose --stack
```

Creates PRs for the current branch and all descendants, each targeting the correct parent.

## Shipping Order

**Ship branches oldest-first (bottom of stack first).**

When a parent branch merges:
1. Run `git town sync`
2. git-town detects the merge
3. Child branches rebase onto the new parent (usually `main`)
4. PRs automatically retarget

Example: If you have `main → A → B → C` and `A` merges:
- After sync: `main → B → C`
- B's PR now targets `main`

## Restructuring Stacks

### Change Parent

```bash
git town set-parent new-parent
```

Moves the current branch to a different parent.

### Detach from Stack

```bash
git town detach
```

Makes the current branch a direct child of main, removing it from the stack.

### Swap Branch Order

```bash
git town swap
```

Swaps the current branch with its parent (experimental).

## Merging Within Stacks

If a child branch should absorb its parent:

```bash
git town merge
```

Merges the current branch into its parent and removes the current branch.

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
