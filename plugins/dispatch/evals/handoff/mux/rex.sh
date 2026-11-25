# shellcheck shell=bash
# Sourced by fixture-lib.sh: the Rex-specific setup, a session that Rex hosts.
for rc in .zshenv .bashrc; do
  printf '%s\n' 'export REX_BLOCK=block:sender' 'unset REX_SESSION' 'unset HERDR_ENV HERDR_PANE_ID' >> "$HOME/$rc"
done
