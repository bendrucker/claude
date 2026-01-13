#!/bin/bash

# PreToolUse hook to intercept wasteful GitLab HTML fetches
# Returns JSON with efficient glab CLI alternatives

# Read JSON input and extract URL
input=$(cat)
url=$(echo "$input" | jq -r '.tool_input.url // empty')

# Only process GitLab URLs
[[ ! "$url" =~ ^https://gitlab\.com/ ]] && exit 0

# Helper function to output JSON response
output_json() {
  local decision="$1"
  local reason="$2"
  jq -n \
    --arg decision "$decision" \
    --arg reason "$reason" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: $decision,
        permissionDecisionReason: $reason
      }
    }'
}

# Parse GitLab URL patterns and deny with efficient alternatives
# GitLab uses /-/ before resource types and supports nested groups

# Project root - get README
if [[ "$url" =~ ^https://gitlab\.com/([^/]+(/[^/]+)*)/?$ ]] && [[ ! "$url" =~ /-/ ]]; then
  output_json "deny" "Use: glab repo view [<project>]"
  exit 0
fi

# Files/directories (GitLab uses /-/blob/ and /-/tree/)
if [[ "$url" =~ /-/blob/([^/]+)/(.+)$ ]] || [[ "$url" =~ /-/tree/([^/]+)/?(.*)$ ]]; then
  output_json "deny" "Use: glab api to fetch file contents"
  exit 0
fi

# Issue
if [[ "$url" =~ /-/issues/([0-9]+) ]]; then
  number="${BASH_REMATCH[1]}"
  output_json "deny" "Use: glab issue view $number"
  exit 0
fi

# Merge request
if [[ "$url" =~ /-/merge_requests/([0-9]+) ]]; then
  number="${BASH_REMATCH[1]}"
  output_json "deny" "Use: glab mr view $number"
  exit 0
fi

# Pipeline
if [[ "$url" =~ /-/pipelines/([0-9]+) ]]; then
  pipeline_id="${BASH_REMATCH[1]}"
  output_json "deny" "Use: glab ci view $pipeline_id"
  exit 0
fi

# Job
if [[ "$url" =~ /-/jobs/([0-9]+) ]]; then
  job_id="${BASH_REMATCH[1]}"
  output_json "deny" "Use: glab ci trace $job_id"
  exit 0
fi

# Unknown GitLab URL pattern - ask user
output_json "ask" "Unknown GitLab URL pattern. Consider using glab CLI."
exit 0
