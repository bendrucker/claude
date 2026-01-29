# Configuration

## Initial Setup

```bash
git town init
```

Interactive prompts cover main branch, perennial branches, hosting platform, and sync strategy.

## Configuration Hierarchy

1. Repository config (`git config --local`)
2. Global config (`git config --global`)
3. Environment variables

## Key Preferences

```bash
# Sync strategy: rebase (default) or merge
git town config sync-feature-strategy rebase

# Push branches on creation
git town config push-new-branches true

# Run pre-push hooks
git town config push-hook true

# Ship strategy: api, squash-merge, or fast-forward
git town config ship-strategy api

# Delete remote branch after shipping
git town config ship-delete-tracking-branch true
```

## Platform Configuration

```bash
# GitHub - use gh CLI (recommended) or token
gh auth login
git town config github-token <token>

# GitLab - use glab CLI (recommended) or token
glab auth login
git town config gitlab-token <token>

# Bitbucket - uses git credentials
git town config hosting-platform bitbucket

# Gitea / Forgejo
git town config hosting-platform gitea
git town config gitea-token <token>

# Self-hosted platforms
git town config hosting-origin-hostname git.example.com
```

## Branch Configuration

```bash
# Perennial branches
git town config perennial-branches add develop
git town config perennial-branches remove develop

# Default type for new branches
git town config default-branch-type feature    # or prototype
```

## Viewing Configuration

```bash
git town config                        # Show all
git town config sync-feature-strategy  # Show specific setting
```

## Environment Variables

Override settings via `GIT_TOWN_<SETTING_NAME>`:

```bash
GIT_TOWN_SYNC_FEATURE_STRATEGY=merge git town sync
```

## CI/CD

```bash
GIT_TOWN_CI=true git town sync   # Disable prompts
git town sync --no-push          # Skip pushing
git town offline true            # No network
```

## Reset

```bash
git town config reset  # Remove settings, preserve branch parents
```
