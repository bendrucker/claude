# Deployment

macOS only.

## Convert XML to Binary

The Shortcuts app expects binary plist. Convert your XML plist:

```bash
plutil -convert binary1 -o "MyShortcut.shortcut" "MyShortcut.plist"
```

To validate the XML before converting:

```bash
plutil -lint "MyShortcut.plist"
```

## Sign

Shortcuts must be signed before import. Signing sends a copy to Apple for validation.

```bash
shortcuts sign -i "MyShortcut.shortcut" -o "MyShortcut-signed.shortcut"
```

Signing modes (for sharing):

```bash
# Anyone can import
shortcuts sign --mode anyone -i "MyShortcut.shortcut" -o "MyShortcut-signed.shortcut"

# Only people in your contacts
shortcuts sign --mode people-who-know-me -i "MyShortcut.shortcut" -o "MyShortcut-signed.shortcut"
```

## Import

```bash
shortcuts import "MyShortcut-signed.shortcut"
```

The shortcut appears in the Shortcuts app. The filename (minus extension) becomes the shortcut name.

## Run

```bash
# Run by name
shortcuts run "MyShortcut"

# Run with input from a file
shortcuts run "MyShortcut" -i input.txt

# Run and capture output to a file
shortcuts run "MyShortcut" -o output.txt

# Run with text piped from stdin
echo "hello" | shortcuts run "MyShortcut"
```

Text output can be piped to other commands:

```bash
shortcuts run "MyShortcut" | jq .
```

## List and Inspect

```bash
# List all shortcuts
shortcuts list

# List shortcuts in a folder
shortcuts list -f "My Folder"

# List folders
shortcuts list --folders

# Open a shortcut in the Shortcuts GUI editor
shortcuts view "MyShortcut"

# Export a shortcut to a file
shortcuts export "MyShortcut" -o "MyShortcut.shortcut"
```

## Iterate

To update a shortcut that's already imported, delete and reimport:

```bash
shortcuts delete "MyShortcut"
shortcuts import "MyShortcut-signed.shortcut"
```

Full iteration cycle:

```bash
# 1. Edit the XML plist source
# 2. Convert
plutil -convert binary1 -o "MyShortcut.shortcut" "MyShortcut.plist"
# 3. Sign
shortcuts sign -i "MyShortcut.shortcut" -o "MyShortcut-signed.shortcut"
# 4. Replace
shortcuts delete "MyShortcut"
shortcuts import "MyShortcut-signed.shortcut"
# 5. Test
shortcuts run "MyShortcut"
```

## Examining Existing Shortcuts

To reverse-engineer an existing shortcut's structure:

```bash
shortcuts export "MyShortcut" -o /tmp/examine.shortcut
plutil -convert xml1 /tmp/examine.shortcut
cat /tmp/examine.shortcut
```

This is the best way to discover how the Shortcuts app encodes specific actions and parameters.
