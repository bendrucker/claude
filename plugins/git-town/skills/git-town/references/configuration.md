# Configuration

git-town configuration controls sync behavior, hosting platform integration, and branch management preferences.

## Initial Setup

Run in any repository:

```bash
git town init
```

Interactive prompts cover:
1. Main branch name
2. Perennial branches (if any)
3. Hosting platform
4. Sync strategy preferences

## Configuration Hierarchy

Settings are checked in order:

1. **Repository config** (`git config --local`) - per-repo settings
2. **Global config** (`git config --global`) - user defaults
3. **Environment variables** - override for CI/scripts

## Key Preferences

### sync-feature-strategy

How feature branches sync with their parent:

```bash
git town config sync-feature-strategy rebase   # Default: rebase onto parent
git town config sync-feature-strategy merge    # Merge parent into branch
```

**Rebase** (recommended): Clean linear history, but rewrites commits.
**Merge**: Preserves original commits, creates merge commits.

### push-new-branches

Whether to push branches immediately after creation:

```bash
git town config push-new-branches true    # Push on hack/append
git town config push-new-branches false   # Don't auto-push
```

### push-hook

Whether to run Git push hooks:

```bash
git town config push-hook true    # Run pre-push hooks
git town config push-hook false   # Skip hooks
```

### ship-strategy

How branches are merged when shipped:

```bash
git town config ship-strategy api           # Use platform's merge API
git town config ship-strategy squash-merge  # Squash via API
git town config ship-strategy fast-forward  # Local fast-forward
```

### ship-delete-tracking-branch

Whether to delete remote branch after shipping:

```bash
git town config ship-delete-tracking-branch true   # Delete remote
git town config ship-delete-tracking-branch false  # Keep remote
```

## Platform Configuration

### GitHub

git-town uses the `gh` CLI or a token:

```bash
# Using gh CLI (recommended)
gh auth login

# Using token directly
git town config github-token <token>
```

### GitLab

git-town uses the `glab` CLI or a token:

```bash
# Using glab CLI (recommended)
glab auth login

# Using token directly
git town config gitlab-token <token>
```

### Bitbucket

```bash
git town config hosting-platform bitbucket
```

Uses git credentials for authentication.

### Gitea / Forgejo

```bash
git town config hosting-platform gitea
git town config gitea-token <token>
```

### Hosting Origin Hostname

For self-hosted platforms:

```bash
git town config hosting-origin-hostname git.example.com
```

## Branch Configuration

### Perennial Branches

Long-lived branches that never get deleted:

```bash
git town config perennial-branches                    # List current
git town config perennial-branches add develop        # Add branch
git town config perennial-branches remove develop     # Remove branch
```

### Default Branch Type

Set the default type for new branches:

```bash
git town config default-branch-type feature     # Default
git town config default-branch-type prototype   # Start as prototype
```

## Viewing Configuration

Show all settings:

```bash
git town config
```

Show specific setting:

```bash
git town config sync-feature-strategy
```

## Environment Variables

Override any setting via environment:

```bash
GIT_TOWN_SYNC_FEATURE_STRATEGY=merge git town sync
```

Pattern: `GIT_TOWN_<SETTING_NAME>` with underscores and uppercase.

## Configuration Storage

Settings stored in git config:

```
git-town.sync-feature-strategy = rebase
git-town.push-new-branches = true
git-town-branch.main.branchtype = perennial
git-town-branch.feature-x.parent = main
```

Branch metadata travels with the repository.

## Resetting Configuration

Remove all git-town config:

```bash
git town config reset
```

This removes git-town settings but preserves branch parent relationships.

## CI/CD Configuration

For automated environments:

```bash
# Disable interactive prompts
GIT_TOWN_CI=true git town sync

# Skip push operations
git town sync --no-push

# Offline mode (no network)
git town offline true
```

## Example: Full Setup

```bash
# Initialize
git town init

# Set preferences
git town config sync-feature-strategy rebase
git town config push-new-branches true
git town config ship-strategy api

# Add perennial branches
git town config perennial-branches add develop
git town config perennial-branches add staging

# Verify
git town config
```
