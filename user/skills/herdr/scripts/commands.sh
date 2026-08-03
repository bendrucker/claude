#!/usr/bin/env bash
# Renders herdr's live command surface for bang-execution in SKILL.md, so a
# session starts with the command list and the hot signatures already in hand.
# Every line comes from `--help` at load time, so it cannot go stale.
set -uo pipefail

command -v herdr >/dev/null 2>&1 || exit 0

groups=(api config workspace worktree tab notification agent pane session integration plugin channel server)
hot=(
  "agent prompt"
  "agent wait"
  "agent read"
  "agent start"
  "pane read"
  "pane wait-output"
  "pane split"
  "pane run"
  "worktree open"
)

for g in "${groups[@]}"; do
  herdr "$g" --help 2>/dev/null |
    awk -v group="$g" '
      /^Commands:/ { inside = 1; next }
      inside && NF == 0 { exit }
      inside { names = names sep $1; sep = ", " }
      END { if (names) print group ": " names }
    '
done

echo

for c in "${hot[@]}"; do
  # shellcheck disable=SC2086
  herdr $c --help 2>/dev/null |
    awk '
      /^Usage:/ && !usage { usage = $0; sub(/^Usage: +/, "", usage); next }
      /^Options:/ { inside = 1; next }
      inside && /^      -/ {
        flag = substr($0, 7)
        sub(/[[:space:]]+$/, "", flag)
        n += 1
        flags[n] = flag
        next
      }
      inside && /\[possible values:/ {
        values = $0
        sub(/^[[:space:]]*\[possible values: /, "", values)
        sub(/\][[:space:]]*$/, "", values)
        split(values, all, ", ")
        values = ""
        for (i = 1; i <= 6 && i in all; i += 1) values = values (i > 1 ? "|" : "") all[i]
        if (7 in all) values = values "|..."
        sub(/ <[A-Z_]+>$/, " " values, flags[n])
      }
      END {
        if (!usage) exit
        sub(/ \[OPTIONS\]/, "", usage)
        for (i = 1; i <= n; i += 1) {
          name = flags[i]
          sub(/[ =].*$/, "", name)
          if (index(flags[i], "|") == 0 && (index(usage, name " ") || index(usage, name ">"))) continue
          opts = opts (opts ? " " : "") "[" flags[i] "]"
        }
        print usage (opts ? "  " opts : "")
      }
    ' | sed 's/^/  /'
done
