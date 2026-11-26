#!/bin/sh
# Claude Code puts a plugin's bin/ on PATH only if it exists when the session's shell starts, so a shim deployed later stays missing until /reload-plugins.
missing=""
for shim in "$@"; do
  command -v "$shim" >/dev/null 2>&1 || missing="$missing \`$shim\`"
done
[ -n "$missing" ] || exit 0
printf 'Stale plugin PATH:%s missing from PATH because this session started before the plugin deployed it. Ask the user to type `/reload-plugins`, wait for them, and confirm with `command -v` before running it. Until then the bare command fails with exit 127, and its absolute path runs inside the sandbox, where it fails too.\n' "$missing"
