#!/usr/bin/env zsh
# shellcheck shell=bash
# Set up Claude configuration with separate installed and development directories
#
# This creates two independent clones:
#   ~/.claude-repo           - Installed version (auto-syncs daily, symlinks point here)
#   ~/src/bendrucker/claude  - Development version (where you make changes)
#
# Safe to run on new computers or existing setups (idempotent)

set -e

CLAUDE_REPO_HOME="$HOME/.claude-repo"
CLAUDE_REPO_DEV="$HOME/src/bendrucker/claude"

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"

if [[ -d "$REPO_ROOT/.git" ]]; then
  REPO_URL=$(git -C "$REPO_ROOT" remote get-url origin)
else
  echo "Error: Cannot detect repo URL - run this script from within the claude repo"
  exit 1
fi

info()    { printf "\033[0;34m==>\033[0m %s\n" "$1"; }
warn()    { printf "\033[0;33mWarning:\033[0m %s\n" "$1"; }
error()   { printf "\033[0;31mError:\033[0m %s\n" "$1" >&2; }
success() { printf "\033[0;32m✓\033[0m %s\n" "$1"; }

detect_state() {
  if [[ -L "$CLAUDE_REPO_HOME" ]]; then
    echo "symlink"
  elif [[ -d "$CLAUDE_REPO_HOME/.git" ]]; then
    echo "clone"
  elif [[ ! -e "$CLAUDE_REPO_HOME" ]]; then
    echo "missing"
  else
    echo "unknown"
  fi
}

get_default_branch() {
  local repo_path="$1"
  local branch

  branch=$(git -C "$repo_path" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')

  if [[ -z "$branch" ]]; then
    git -C "$repo_path" remote set-head origin --auto 2>/dev/null || true
    branch=$(git -C "$repo_path" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
  fi

  echo "${branch:-main}"
}

main() {
  info "Setting up Claude configuration with separate installed and development directories"
  echo "  Repo URL: $REPO_URL"
  echo "  Installed: $CLAUDE_REPO_HOME"
  echo "  Development: $CLAUDE_REPO_DEV"
  echo ""

  info "Detecting current state..."
  local state
  state=$(detect_state)
  echo "  Current state: $state"

  case $state in
    symlink)
      info "Removing symlink at $CLAUDE_REPO_HOME..."
      rm "$CLAUDE_REPO_HOME"

      info "Cloning fresh copy to $CLAUDE_REPO_HOME..."
      git clone "$REPO_URL" "$CLAUDE_REPO_HOME"
      git -C "$CLAUDE_REPO_HOME" remote set-head origin --auto 2>/dev/null || true
      success "Installed repo cloned"
      ;;

    clone)
      info "$CLAUDE_REPO_HOME is already a git clone"

      git -C "$CLAUDE_REPO_HOME" remote set-head origin --auto 2>/dev/null || true
      local default_branch
      default_branch=$(get_default_branch "$CLAUDE_REPO_HOME")

      info "Updating to latest ($default_branch)..."
      git -C "$CLAUDE_REPO_HOME" fetch origin "$default_branch"
      git -C "$CLAUDE_REPO_HOME" checkout "$default_branch" 2>/dev/null || true
      git -C "$CLAUDE_REPO_HOME" pull --ff-only origin "$default_branch" || {
        warn "Could not fast-forward - you may have local changes"
      }
      success "Installed repo updated"
      ;;

    missing)
      info "No ~/.claude-repo found - fresh install"
      info "Cloning to $CLAUDE_REPO_HOME..."
      git clone "$REPO_URL" "$CLAUDE_REPO_HOME"
      git -C "$CLAUDE_REPO_HOME" remote set-head origin --auto 2>/dev/null || true
      success "Installed repo cloned"
      ;;

    *)
      error "Unknown state at $CLAUDE_REPO_HOME - please investigate manually"
      exit 1
      ;;
  esac

  info "Checking development directory..."
  if [[ -d "$CLAUDE_REPO_DEV/.git" ]]; then
    info "Development directory already exists at $CLAUDE_REPO_DEV"
    success "Development repo ready"
  elif [[ -e "$CLAUDE_REPO_DEV" ]]; then
    warn "$CLAUDE_REPO_DEV exists but is not a git repo"
    warn "Please move or remove it, then re-run this script"
  else
    info "Creating development directory..."
    mkdir -p "$(dirname "$CLAUDE_REPO_DEV")"
    git clone "$REPO_URL" "$CLAUDE_REPO_DEV"
    git -C "$CLAUDE_REPO_DEV" remote set-head origin --auto 2>/dev/null || true
    success "Development repo cloned"
  fi

  if [[ -L "$CLAUDE_REPO_HOME" ]]; then
    error "$CLAUDE_REPO_HOME is still a symlink - something went wrong"
    exit 1
  fi

  local home_git dev_git
  home_git=$(cd "$CLAUDE_REPO_HOME" && pwd -P)/.git
  dev_git=$(cd "$CLAUDE_REPO_DEV" && pwd -P)/.git

  if [[ "$home_git" == "$dev_git" ]]; then
    error "Both directories share the same .git - this shouldn't happen"
    exit 1
  fi

  success "Separate directories verified"

  info "Creating symlinks from ~/.claude to installed repo..."
  "$CLAUDE_REPO_HOME/scripts/install.sh"

  if [[ "$(uname)" == "Darwin" ]] && [[ -x "$CLAUDE_REPO_HOME/macos/install.sh" ]]; then
    info "Setting up macOS launchd job..."
    "$CLAUDE_REPO_HOME/macos/install.sh"
  fi

  echo ""
  success "Setup complete!"
  echo ""
  echo "  Installed repo: $CLAUDE_REPO_HOME (auto-syncs daily at 3:30 AM)"
  echo "  Development repo: $CLAUDE_REPO_DEV (for making changes)"
  echo ""
  echo "  Symlinks in ~/.claude now point to the installed repo."
  echo "  Restart Claude Code to apply changes."
}

main "$@"
