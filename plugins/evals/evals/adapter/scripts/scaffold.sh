#!/usr/bin/env bash
# Usage: scaffold.sh <framework> <interface|guide>, run from the session's working directory.
# Stubs go in the run's home so they outlive the staged tree. The Bash tool's zsh sources .zshenv
# and its bash sources .bashrc, so both put them first on PATH. Only the seen run is copied, and
# never a truth.json, so the session can't read what the scorer checks.
set -euo pipefail
framework="$1"
suite="$(cd "$(dirname "$0")/.." && pwd)"
src="$suite/frameworks/$framework"
bash "$src/setup.sh" "$PWD"
mkdir evals
rsync -a --exclude '*.test.ts' --exclude __snapshots__ "$suite/../../../../packages/evals/" evals/
if [ "$2" = guide ]; then
  cp "$suite/../../skills/hill-climb/references/harnesses.md" harnesses.md
fi
mkdir -p runs
rsync -a --exclude truth.json --exclude rescore.patch "$src/fixtures/seen/" runs/seen/
stubs="$HOME/.adapter-stubs"
mkdir -p "$stubs/fixtures"
rsync -a "$src/stub/" "$stubs/stub/"
rsync -a --exclude truth.json --exclude rescore.patch "$src/fixtures/seen/" "$stubs/fixtures/seen/"
line="export PATH=\"$stubs/stub/bin:\$PATH\""
echo "$line" >> "$HOME/.zshenv"
echo "$line" >> "$HOME/.bashrc"
