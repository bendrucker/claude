# Branch Types

git-town categorizes branches to determine sync behavior.

## Feature Branches

Default type. Created with `git town hack` or `git town append`. Rebase onto parent, push, deleted after PR merges.

## Perennial Branches

Long-lived branches (`main`, `develop`, `staging`). Pull from remote, never rebase or delete.

```bash
git town config perennial-branches add staging
```

## Contribution Branches

For repos you don't own. Rebase onto tracking branch but don't push automatically.

```bash
git town contribute  # Mark current branch
```

## Observed Branches

Branches you watch but don't modify. Pull only, never push or delete.

```bash
git town observe feature-x
```

## Parked Branches

Temporarily excluded from sync. Useful for pausing work-in-progress.

```bash
git town park     # Exclude from sync
git town unpark   # Resume syncing
```

## Prototype Branches

Local-only branches not ready to push. `git town propose` automatically un-prototypes.

```bash
git town prototype
```

## Sync Behavior Summary

| Branch Type  | Rebase | Push | Delete After Merge |
|--------------|--------|------|-------------------|
| Feature      | Yes    | Yes  | Yes               |
| Perennial    | No     | Yes  | No                |
| Contribution | Yes    | No   | No                |
| Observed     | No     | No   | No                |
| Parked       | Skip   | Skip | No                |
| Prototype    | Yes    | No   | Yes               |

## Changing Branch Type

Type commands toggle on/off: `git town contribute`, `git town observe`, `git town park`, `git town prototype`

## Viewing Branches

```bash
git town branch     # Current branch info
git town branches   # All branches with types
```
