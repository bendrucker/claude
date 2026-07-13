# Deployment

macOS only. For running and managing shortcuts after deployment, use the `shortcuts:cli` skill.

## Pipeline

```bash
plutil -lint "My Shortcut.plist"
plutil -convert binary1 -o "My Shortcut.shortcut" "My Shortcut.plist"
mkdir -p out
shortcuts sign -i "My Shortcut.shortcut" -o "out/My Shortcut.shortcut"
open "out/My Shortcut.shortcut"
```

Sign into an `out/` directory to preserve the unsigned binary for re-signing after edits. The filename must match the desired shortcut name — the filename (minus `.shortcut`) becomes the name in the Shortcuts app.

## Convert XML to Binary

The Shortcuts app expects binary plist. Validate and convert.

```bash
plutil -lint "My Shortcut.plist"
plutil -convert binary1 -o "My Shortcut.shortcut" "My Shortcut.plist"
```

## Sign

Shortcuts must be signed before import. Signing contacts Apple's validation service (requires network).

Sign into an output directory to preserve the unsigned binary for iteration:

```bash
mkdir -p out
shortcuts sign -i "My Shortcut.shortcut" -o "out/My Shortcut.shortcut"
```

**The filename (minus `.shortcut`) becomes the shortcut name in the Shortcuts app.** Do not add suffixes like `-signed` to the output path.

Signing modes (for sharing):

```bash
shortcuts sign --mode anyone -i "My Shortcut.shortcut" -o "out/My Shortcut.shortcut"
shortcuts sign --mode people-who-know-me -i "My Shortcut.shortcut" -o "out/My Shortcut.shortcut"
```

## Import

Open the signed file to trigger the Shortcuts app import flow.

```bash
open "out/My Shortcut.shortcut"
```

The user confirms the import in the Shortcuts app GUI.

## Iterate

To update an imported shortcut, delete it in the Shortcuts app, then rebuild and reimport:

```bash
plutil -convert binary1 -o "My Shortcut.shortcut" "My Shortcut.plist"
shortcuts sign -i "My Shortcut.shortcut" -o "out/My Shortcut.shortcut"
open "out/My Shortcut.shortcut"
```

There is no CLI command for deleting shortcuts.
