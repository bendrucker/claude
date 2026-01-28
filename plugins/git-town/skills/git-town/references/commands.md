# Command Reference

Complete reference for git-town commands organized by category.

## Workflow Commands

### hack

Create a new feature branch from main:

```bash
git town hack <branch-name>
git town hack -p              # Prompt for name
git town hack --no-push       # Don't push new branch
```

### sync

Synchronize branches with their parents and remotes:

```bash
git town sync                 # Sync current branch
git town sync --all           # Sync all branches
git town sync --stack         # Sync current branch and descendants
git town sync --dry-run       # Show what would happen
git town sync --no-push       # Sync without pushing
```

### propose

Create a pull request for the current branch:

```bash
git town propose              # Open PR creation page
git town propose --stack      # Create PRs for entire stack
git town propose --title "…"  # Set PR title
git town propose --body "…"   # Set PR body
git town propose --body-file  # Read body from file
```

### ship

Merge a completed feature branch:

```bash
git town ship                 # Ship current branch
git town ship <branch>        # Ship specific branch
git town ship --message "…"   # Set merge commit message
```

### switch

Switch between branches:

```bash
git town switch               # Interactive branch picker
git town switch <branch>      # Switch to specific branch
```

## Stack Commands

### append

Create a child branch of the current branch:

```bash
git town append <branch-name>
git town append -p            # Prompt for name
```

### prepend

Insert a branch between current and its parent:

```bash
git town prepend <branch-name>
git town prepend -p           # Prompt for name
```

### up / down

Navigate the branch stack:

```bash
git town up                   # Move to first child
git town down                 # Move to parent
```

### set-parent

Change the parent of the current branch:

```bash
git town set-parent           # Interactive parent selection
git town set-parent <branch>  # Set specific parent
```

### detach

Remove current branch from its stack:

```bash
git town detach               # Make direct child of main
```

### merge

Merge current branch into its parent:

```bash
git town merge                # Combine with parent branch
```

### swap

Swap current branch with its parent:

```bash
git town swap                 # Exchange positions in stack
```

## Branch Type Commands

### contribute

Mark branch for contribution workflow (no auto-push):

```bash
git town contribute           # Toggle contribution mode
git town contribute <branch>  # Toggle specific branch
```

### observe

Mark branch as observed (pull only):

```bash
git town observe              # Toggle observed mode
git town observe <branch>     # Toggle specific branch
```

### park

Exclude branch from sync operations:

```bash
git town park                 # Toggle parked mode
git town park <branch>        # Toggle specific branch
```

### prototype

Mark branch as prototype (no push):

```bash
git town prototype            # Toggle prototype mode
git town prototype <branch>   # Toggle specific branch
```

## Recovery Commands

### undo

Reverse the last git-town command:

```bash
git town undo                 # Undo last operation
```

### continue

Resume after resolving conflicts:

```bash
git town continue             # Continue paused operation
```

### skip

Skip the current commit during rebase:

```bash
git town skip                 # Skip problematic commit
```

### abort

Cancel an in-progress operation:

```bash
git town abort                # Restore previous state
```

## Information Commands

### status

Show current operation status:

```bash
git town status               # Show pending operation
git town status --pending     # Check if operation pending
```

### branch

Show branch information:

```bash
git town branch               # Current branch details
```

### branches

Show all branches:

```bash
git town branches             # List with hierarchy
```

### diff-parent

Show changes since parent branch:

```bash
git town diff-parent          # Diff against parent
```

## Configuration Commands

### init

Initialize git-town in a repository:

```bash
git town init                 # Interactive setup
```

### config

Manage configuration:

```bash
git town config                        # Show all config
git town config perennial-branches     # List perennial branches
git town config perennial-branches add <branch>
git town config perennial-branches remove <branch>
```

### completions

Generate shell completions:

```bash
git town completions bash     # Bash completions
git town completions zsh      # Zsh completions
git town completions fish     # Fish completions
```

## Offline Commands

### offline

Enable/disable offline mode:

```bash
git town offline              # Toggle offline mode
git town offline true         # Enable offline
git town offline false        # Disable offline
```

In offline mode, git-town skips all network operations.

## Common Flag Patterns

### --stack

Available on: `sync`, `propose`

Applies the command to the current branch and all descendants.

### --all

Available on: `sync`

Applies the command to all branches in the repository.

### --dry-run

Available on: `sync`

Shows what would happen without making changes.

### --no-push

Available on: `hack`, `sync`

Performs the operation without pushing to remote.

### -p / --prompt

Available on: `hack`, `append`, `prepend`

Interactively prompt for the branch name.
