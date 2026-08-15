#!/bin/bash
# claude:dangerouslyDisableSandbox: registers the bundle with Launch Services, which the command sandbox blocks
set -euo pipefail

# Build xcall.app — a macOS .app bundle for x-callback-url bridging.
#
# The .app bundle is required because macOS only delivers URL scheme
# callbacks to registered applications with CFBundleURLTypes in Info.plist.
#
# Output (stdout): path to the compiled binary inside the .app bundle.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$SCRIPT_DIR/main.swift"

# macOS registers exactly one handler for xcall-claude://, so one bundle serves
# every consumer, at a path belonging to none of them. A second bundle takes the
# scheme, and lsregister -f does not hand it back, so each consumer with its own
# copy would retire the others in turn. The path also sits outside the plugin
# tree, whose marketplace cache is content-addressed and rotates its hash per
# version, leaving Launch Services on a deleted path after an update.
STATE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/claude/x-callback-url"
APP_DIR="$STATE_DIR/xcall.app"
STAMP="$STATE_DIR/installed"
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

# The stamp records that the scheme is bound to this bundle. A run that compiles
# and then fails to register leaves none, so the next call retries the
# registration rather than treating the binary's presence as an install and
# waiting out a callback Launch Services routes elsewhere. Re-reading the
# binding costs an lsregister dump, seconds of work, so it happens on install.
needs_install() {
  [[ ! -x "$BINARY" ]] || [[ ! -f "$STAMP" ]] || [[ "$SOURCE" -nt "$STAMP" ]]
}

# Both files land through a private path and one rename, so nothing ever reads a
# half-written bundle. One bundle now serves every consumer, so two sessions
# reaching a cold cache together both install into the same paths. Each gets its
# own $$-suffixed scratch file, and rename within a directory is atomic, so the
# loser of that race is discarded whole instead of interleaved into the winner.
build_bundle() {
  mkdir -p "$MACOS_DIR"
  trap 'rm -f "$BINARY.$$" "$CONTENTS_DIR/Info.plist.$$"' EXIT

  swiftc "$SOURCE" -o "$BINARY.$$"
  mv -f "$BINARY.$$" "$BINARY"

  # CFBundleTypeRole=Editor ensures macOS delivers GetURL Apple Events to this app.
  # LSUIElement hides from Dock and Cmd-Tab without disabling URL scheme handling.
  # LSBackgroundOnly would disable it.
  cat > "$CONTENTS_DIR/Info.plist.$$" << 'PLIST'
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

  mv -f "$CONTENTS_DIR/Info.plist.$$" "$CONTENTS_DIR/Info.plist"
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

if needs_install; then
  build_bundle
  register_bundle
  : >"$STAMP"
fi

echo "$BINARY"
