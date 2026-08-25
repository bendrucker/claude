#!/usr/bin/env bash
#
# Human-in-the-loop reproduction loop. Copy this file, replace the block between
# the edit markers, and have the user run it in their own terminal.
#
#   step "<instruction>"        print an instruction, wait for the user
#   observe NAME "<question>"   ask a question, record one line as NAME
#
# Answers print under RESULTS at exit, one NAME=value per line, including on an
# abort partway through. Use step, never observe, for anything that involves a
# credential.

set -euo pipefail

if [ ! -t 0 ]; then
  echo 'hitl-loop needs a terminal: have the user run it, not a tool call' >&2
  exit 2
fi

results=()

step() {
  printf '\n>>> %s\n' "$1"
  read -r -p '    press enter when done '
}

observe() {
  local name=$1 question=$2 answer
  printf '\n>>> %s\n' "$question"
  IFS= read -r -p '    > ' answer
  results+=("$name=$answer")
}

report() {
  printf '\n--- RESULTS ---\n'
  if [ ${#results[@]} -gt 0 ]; then
    printf '%s\n' "${results[@]}"
  fi
}

trap report EXIT

# --- replace below ----------------------------------------------------------

step 'Open http://localhost:3000 and sign in.'

observe FAILED 'Click Export. Did it fail? (y/n)'

observe SYMPTOM 'Type the first line of the error, or none.'

# --- replace above ----------------------------------------------------------
