---
name: raycast:publish
description: Prepare a Raycast extension for the Store. Covers the changelog entry, build and lint, manifest requirements, and the pull request checklist. Use before releasing or submitting an extension.
---

# Publish

Preflight only. Once the extension passes, hand the branch to `/ship`, which opens the pull request against `raycast/extensions`.

Never run `npm run publish`. It authenticates with GitHub and opens that pull request itself.

## Changelog

`CHANGELOG.md` at the extension root takes a new entry at the top:

```markdown
## [Added Search Filters] - {PR_MERGE_DATE}

- Added a priority filter to search results
```

Leave `{PR_MERGE_DATE}` literal. The merge workflow substitutes the date, so a hardcoded one goes stale while the PR waits. The `changelog_enforcer` workflow fails a PR that adds no entry.

## Checks

Run `npm run build` to type-check and bundle the distribution build, and `npm run lint` for style. Fix what either reports before opening the pull request.

## Manifest

- `author` is the Raycast username
- `license` is `MIT`
- `package-lock.json` is committed
- `platforms` matches what the extension needs
- at least one category

Icons are 512x512 PNG and screenshots 2000x1250 PNG, three to six of them. See the `raycast` skill's [store reference](../raycast/references/store.md) for the full media rules.

## Pull Request

One extension per pull request. Fill in the template's Description and Screencast, and work its checklist: store guidelines read, publishing docs read, distribution build ran and tested, every asset in `assets/` used, README media outside `metadata/`.

A fork branch has to allow maintainer edits, which a CI job enforces. GitHub sets it from the "Allow edits by maintainers" box at PR creation.
