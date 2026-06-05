#!/bin/sh
# Run a bun hook so only its decision payload reaches stdout.
#
# bun's install summary ("bun install v...", "Checked N installs") prints to
# stdout, the same stream Claude Code captures as a hook's additionalContext.
# When a package's dependencies are missing, install them silently off stdout,
# then run with auto-install disabled so no install banner can reach fd1.
unset CDPATH
target=$1
if [ -d "$target" ]; then
  start=$target
else
  start=$(dirname -- "$target")
fi
root=$(cd -- "$start" && pwd)
while [ ! -f "$root/package.json" ] && [ "$root" != "/" ]; do
  root=$(dirname -- "$root")
done
if [ -f "$root/package.json" ] && [ ! -d "$root/node_modules" ]; then
  (cd "$root" && bun install --silent >/dev/null 2>&1)
fi
exec bun --no-install "$@"
