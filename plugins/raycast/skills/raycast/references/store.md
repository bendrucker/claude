# Store

Publishing requirements for the Raycast Store.

## Naming

Use Apple Style Title Case for extension and command titles:
- "Google Workspace" not "Google workspace"
- "Search in Database" not "search in database"

Extension titles should be nouns ("Emoji Search" not "Search Emoji"). Command titles use `<verb> <noun>` ("Create Issue", "Search Items").

## Icon

- 512x512 PNG in `assets/`
- Must render clearly in both light and dark themes
- Cannot use the default Raycast icon
- Generate icons at [icon.ray.so](https://icon.ray.so)

## Screenshots

- 2000x1250 PNG (16:10 aspect ratio)
- Three minimum, six maximum
- Consistent background across all screenshots
- No sensitive data or other applications visible

## Documentation

**CHANGELOG.md** (recommended):
```markdown
## [Added Search Filters] - {PR_MERGE_DATE}

- Added priority filter to search results
- Fixed pagination for large result sets
```

Use `{PR_MERGE_DATE}` instead of a hardcoded date — the Raycast Store replaces it with the actual merge date when the PR lands. This avoids stale dates when review takes longer than expected. Title must be in square brackets, separated from the date by ` - `.

**README.md** (required if setup is needed):
- Place at extension root
- Enables "About This Extension" button in preferences
- Store media files in a top-level `media/` folder

## Pre-Submission Checklist

- `npm run build` passes (type checking and bundling)
- `npm run lint` passes (code style)
- `package.json` has correct `author` (Raycast username), `MIT` license, latest `@raycast/api`
- `package-lock.json` is committed
- `platforms` field matches extension requirements
- At least one category selected
- Icon meets specifications
- Screenshots meet specifications

## Publishing

```bash
npm run publish
```

This opens the Store submission flow in Raycast.

## Categories

Applications, Communication, Data, Design Tools, Developer Tools, Documentation, Finance, Fun, Media, News, Productivity, Security, System, Web, Other.
