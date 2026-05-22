#!/bin/bash
set -euo pipefail

# Build xcall.app — a macOS .app bundle for x-callback-url bridging.
#
# The .app bundle is required because macOS only delivers URL scheme
# callbacks to registered applications with CFBundleURLTypes in Info.plist.
#
# Installs into ${CLAUDE_PLUGIN_DATA} so the bundle survives plugin cache
# invalidation. Builds inside the plugin's cache directory would otherwise
# go stale whenever the plugin's content hash rotates, leaving Launch
# Services pointing at a deleted path.
#
# Output (stdout): path to the compiled binary inside the .app bundle.
# Cached: only recompiles if main.swift is newer than the existing binary.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$SCRIPT_DIR/main.swift"

INSTALL_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/x-callback-url-bendrucker}"
APP_DIR="$INSTALL_DIR/xcall.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
BINARY="$MACOS_DIR/xcall"

LEGACY_APP_DIR="$SCRIPT_DIR/xcall.app"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister

scheme_handler_path() {
  "$LSREGISTER" -dump 2>/dev/null \
    | awk 'BEGIN { RS = "--------------------------------------------------------------------------------" } /com\.bendrucker\.xcall-claude/' \
    | awk '/^path:/ { sub(/^path:[[:space:]]+/, ""); sub(/[[:space:]]+\([^)]+\)$/, ""); print; exit }'
}

unregister_legacy_bundle() {
  if [[ -d "$LEGACY_APP_DIR" && "$LEGACY_APP_DIR" != "$APP_DIR" ]]; then
    "$LSREGISTER" -u "$LEGACY_APP_DIR" >/dev/null 2>&1 || true
    rm -rf "$LEGACY_APP_DIR"
  fi
}

needs_rebuild() {
  [[ ! -x "$BINARY" ]] || [[ "$SOURCE" -nt "$BINARY" ]]
}

build_bundle() {
  mkdir -p "$MACOS_DIR"
  swiftc "$SOURCE" -o "$BINARY"

  # CFBundleTypeRole=Editor ensures macOS delivers GetURL Apple Events to this app.
  # LSUIElement hides from Dock and Cmd-Tab without disabling URL scheme handling
  # (which LSBackgroundOnly would do — kept that out deliberately).
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
</dict>
</plist>
PLIST
}

register_bundle() {
  "$LSREGISTER" -f "$APP_DIR"

  local handler
  handler="$(scheme_handler_path)"
  if [[ "$handler" != "$APP_DIR" ]]; then
    echo "lsregister did not bind xcall-claude:// to $APP_DIR (got: ${handler:-<none>})" >&2
    exit 1
  fi
}

unregister_legacy_bundle

if needs_rebuild; then
  build_bundle
  register_bundle
fi

echo "$BINARY"
