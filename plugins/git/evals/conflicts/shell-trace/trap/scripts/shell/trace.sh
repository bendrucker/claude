# shellcheck shell=dash
# Span markers for the bootstrap path, read by scripts/trace-report. Inert
# unless DOTFILES_TRACE_DIR is set. POSIX: it is sourced before bun exists.
# trace_begin <name> and trace_end bracket a step, keeping $?. trace_run <cmd>…
# also times each output line, once bun is installed.

# Fractions are padded or cut to nine digits: zsh prints ten, bash six.
trace_now() {
  if [ -n "${EPOCHREALTIME-}" ]; then
    _trace_f=${EPOCHREALTIME#*[.,]}000000000
    trace_t=${EPOCHREALTIME%[.,]*}${_trace_f%"${_trace_f#?????????}"}
    # Bare, bash 5.2 returns the status the EXIT trap fired with, and set -e quits.
    return 0
  fi
  trace_t=$(date +%s%N)
  case $trace_t in *[!0-9]* | "") trace_t=$(perl -MTime::HiRes=time -e 'printf "%.0f", time * 1e9' 2>/dev/null || echo "$(date +%s)000000000") ;; esac
}

trace_mark() {
  trace_now
  printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$trace_t" "$$" "$2" "$(printf %s "$3" | tr '\t\n' '  ')" >>"$DOTFILES_TRACE_DIR/events.tsv"
}

trace_begin() { [ -n "${DOTFILES_TRACE_DIR-}" ] && trace_mark B 0 "$1"; return 0; }
trace_end() { _trace_s=$?; [ -n "${DOTFILES_TRACE_DIR-}" ] && trace_mark E "$_trace_s" ""; return "$_trace_s"; }

trace_run() {
  if [ -n "${DOTFILES_TRACE_DIR-}" ] && command -v bun >/dev/null 2>&1; then
    bun "${ZSH:-$HOME/.dotfiles}/scripts/trace-run" -- "$@"
  else
    "$@"
  fi
}

# A failure under set -e skips every trace_end, so an EXIT trap records the
# exit status as an X line.
if [ -n "${DOTFILES_TRACE_DIR-}" ]; then
  [ -n "${ZSH_VERSION-}" ] && zmodload zsh/datetime
  mkdir -p "$DOTFILES_TRACE_DIR"
  if [ -z "${GIT_TRACE2_EVENT-}" ]; then
    mkdir -p "$DOTFILES_TRACE_DIR/git"
    export GIT_TRACE2_EVENT="$DOTFILES_TRACE_DIR/git"
  fi
  trap '_trace_s=$?; trace_now; printf "X\t%s\t%s\t%s\n" "$trace_t" "$$" "$_trace_s" >>"$DOTFILES_TRACE_DIR/events.tsv"' EXIT
fi
