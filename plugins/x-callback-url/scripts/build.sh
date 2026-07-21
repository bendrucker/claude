#!/bin/bash
set -euo pipefail

# Build xcall.app — a macOS .app bundle for x-callback-url bridging.
#
# The .app bundle is required because macOS only delivers URL scheme
# callbacks to registered applications with CFBundleURLTypes in Info.plist.
#
# Installs into ${CLAUDE_PLUGIN_DATA}. Marketplace installs put plugin sources
# in a content-addressed cache directory whose hash rotates per plugin version,
# so a bundle built beside the source would leave Launch Services pointing at a
# deleted path after any plugin update.
#
# Output (stdout): path to the compiled binary inside the .app bundle.
# Cached: only recompiles if main.swift is newer than the existing binary.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$SCRIPT_DIR/main.swift"

# Claude Code exports CLAUDE_PLUGIN_DATA to hooks and MCP servers but not to
# Bash tool calls. A caller reached from a Bash invocation passes it explicitly,
# taking the value from its own skill, where the variable is substituted.
if [[ -z "${CLAUDE_PLUGIN_DATA:-}" ]]; then
  echo "CLAUDE_PLUGIN_DATA is not set; pass it explicitly, as the things:url skill does" >&2
  exit 1
fi

APP_DIR="$CLAUDE_PLUGIN_DATA/xcall.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
BINARY="$MACOS_DIR/xcall"

LEGACY_APP_DIR="$SCRIPT_DIR/xcall.app"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister

# Launch Services reports bundle paths with symlinks resolved, so comparing its
# answer against an unresolved path (a data dir under /var, say) reads as a
# binding failure when the registration is correct.
canonical_path() {
  local target="$1"
  if [[ -d "$target" ]]; then
    (cd "$target" && pwd -P)
  else
    printf '%s\n' "$target"
  fi
}

scheme_handler_path() {
  "$LSREGISTER" -dump 2>/dev/null \
    | awk 'BEGIN { RS = "--------------------------------------------------------------------------------" } /com\.bendrucker\.xcall-claude/' \
    | awk '/^path:/ { sub(/^path:[[:space:]]+/, ""); sub(/[[:space:]]+\([^)]+\)$/, ""); print; exit }'
}

# Deleting an already-unregistered bundle is best effort: the plugin tree can be
# read-only under the sandbox, and failing to clean it up should not take down a
# callback that is otherwise working.
unregister_legacy_bundle() {
  if [[ -d "$LEGACY_APP_DIR" && "$LEGACY_APP_DIR" != "$APP_DIR" ]]; then
    "$LSREGISTER" -u "$LEGACY_APP_DIR" >/dev/null 2>&1 || true
    rm -rf "$LEGACY_APP_DIR" || true
  fi
}

needs_rebuild() {
  [[ ! -x "$BINARY" ]] || [[ "$SOURCE" -nt "$BINARY" ]]
}

build_bundle() {
  mkdir -p "$MACOS_DIR"
  swiftc "$SOURCE" -o "$BINARY"

  # CFBundleTypeRole=Editor ensures macOS delivers GetURL Apple Events to this app.
  # LSUIElement hides from Dock and Cmd-Tab without disabling URL scheme handling.
  # LSBackgroundOnly would disable it.
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

# A bundle can survive at a path an earlier version of this script built into.
# Launch Services keeps delivering xcall-claude:// to that copy, and
# `lsregister -f` on the new bundle does not take the scheme back, so the
# waiting process never sees its callback and times out. Retire the stale copy
# instead. Only paths ending in xcall.app are removed, and scheme_handler_path
# only ever reports bundles carrying this plugin's identifier.
retire_stale_handler() {
  local handler="$1"
  [[ "$handler" == */xcall.app ]] || return 1

  "$LSREGISTER" -u "$handler" >/dev/null 2>&1 || true
  rm -rf "$handler" || true
  "$LSREGISTER" -f "$APP_DIR"
}

register_bundle() {
  "$LSREGISTER" -f "$APP_DIR"

  local want handler
  want="$(canonical_path "$APP_DIR")"

  handler="$(canonical_path "$(scheme_handler_path)")"
  if [[ -n "$handler" && "$handler" != "$want" ]]; then
    retire_stale_handler "$handler" || true
    handler="$(canonical_path "$(scheme_handler_path)")"
  fi

  if [[ "$handler" != "$want" ]]; then
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
