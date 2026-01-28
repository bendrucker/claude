#!/bin/bash
set -euo pipefail

# Build xcall.app — a macOS .app bundle for x-callback-url bridging
#
# The .app bundle is required because macOS only delivers URL scheme
# callbacks to registered applications with CFBundleURLTypes in Info.plist.
#
# Output: <script_dir>/xcall.app/Contents/MacOS/xcall
# The build is cached — only rebuilds if main.swift is newer than the binary.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR/xcall.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
BINARY="$MACOS_DIR/xcall"
SOURCE="$SCRIPT_DIR/main.swift"
CALLBACK_SCHEME="xcall-claude"

if [[ -x "$BINARY" && "$BINARY" -nt "$SOURCE" ]]; then
  echo "$BINARY"
  exit 0
fi

mkdir -p "$MACOS_DIR"

swiftc "$SOURCE" -o "$BINARY"

# Info.plist registers the callback URL scheme and keeps the app out of the Dock.
# CFBundleTypeRole is Editor (not Viewer) to ensure macOS delivers URL events.
# LSUIElement hides the app from the Dock and Cmd-Tab switcher.
cat > "$CONTENTS_DIR/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>xcall</string>
  <key>CFBundleIdentifier</key>
  <string>com.bendrucker.xcall-claude</string>
  <key>CFBundleName</key>
  <string>xcall</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeRole</key>
      <string>Editor</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>xcall-claude</string>
      </array>
    </dict>
  </array>
  <key>LSUIElement</key>
  <true/>
  <key>LSBackgroundOnly</key>
  <true/>
</dict>
</plist>
PLIST

# Register the URL scheme with Launch Services
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f "$APP_DIR" 2>/dev/null || true

echo "$BINARY"
