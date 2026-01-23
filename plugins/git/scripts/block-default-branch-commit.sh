#!/bin/bash

# PreToolUse hook to block direct commits to the default branch
# Matcher: Bash(git commit:*) handles filtering to git commit commands

# Check if we are in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  exit 0
fi

get_default_branch() {
  local repo_root
  repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || return
  local safe_path="${repo_root//\//_}"
  local cache_file="${TMPDIR:-/tmp}/claude-default-branch${safe_path}"

  # Check cache (valid for current session)
  if [[ -f "$cache_file" ]]; then
    cat "$cache_file"
    return 0
  fi
  
  local default_branch
  
  # Try git symbolic-ref first
  default_branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
  
  # Fall back to gh repo view
  if [[ -z "$default_branch" ]]; then
    default_branch=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null)
  fi
  
  # Cache the result if found
  if [[ -n "$default_branch" ]]; then
    printf "%s" "$default_branch" > "$cache_file"
    printf "%s" "$default_branch"
  fi
}

get_current_branch() {
  git symbolic-ref --short HEAD 2>/dev/null
}

current_branch=$(get_current_branch)

# Handle detached HEAD - allow commits
if [[ -z "$current_branch" ]]; then
  exit 0
fi

default_branch=$(get_default_branch)

# If we could not determine default branch, allow the commit
if [[ -z "$default_branch" ]]; then
  exit 0
fi

# Block if on default branch
if [[ "$current_branch" == "$default_branch" ]]; then
  jq -n \
    --arg branch "$default_branch" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: ("Cannot commit directly to " + $branch + ". Create a topic branch first with: git checkout -b <branch-name>")
      }
    }'
fi
