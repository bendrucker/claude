#!/usr/bin/env bash
set -euo pipefail

SESSION_ID="${1:-}"
if [[ -z "$SESSION_ID" ]]; then
  echo "Usage: info.sh <session-id>" >&2
  exit 1
fi

PROJECTS_DIR="$HOME/.claude/projects"
SESSION_FILE=$(find "$PROJECTS_DIR" -name "${SESSION_ID}.jsonl" -type f 2>/dev/null | head -1)

if [[ -z "$SESSION_FILE" ]]; then
  echo "Session file not found for ID: $SESSION_ID" >&2
  exit 1
fi

echo "Session: $SESSION_ID"
echo "File: $SESSION_FILE"
echo ""

# Extract metadata from first message
FIRST_MSG=$(head -1 "$SESSION_FILE")
START_TIME=$(echo "$FIRST_MSG" | jq -r '.timestamp // empty')
GIT_BRANCH=$(grep -m1 '"gitBranch"' "$SESSION_FILE" | jq -r '.gitBranch // empty')
CWD=$(grep -m1 '"cwd"' "$SESSION_FILE" | jq -r '.cwd // empty')

if [[ -n "$START_TIME" ]]; then
  echo "Started: $START_TIME"
fi
if [[ -n "$GIT_BRANCH" ]]; then
  echo "Branch: $GIT_BRANCH"
fi
if [[ -n "$CWD" ]]; then
  echo "Directory: $CWD"
fi

echo ""
echo "Message counts:"
jq -r '.type' "$SESSION_FILE" | sort | uniq -c | sort -rn | head -10

echo ""
echo "Tool usage:"
jq -r '.message.content[]? | select(.type == "tool_use") | .name' "$SESSION_FILE" 2>/dev/null | sort | uniq -c | sort -rn | head -15

# Check for summary
SUMMARY=$(grep '"type":"summary"' "$SESSION_FILE" | tail -1 | jq -r '.summary // empty' 2>/dev/null || true)
if [[ -n "$SUMMARY" ]]; then
  echo ""
  echo "Latest summary:"
  echo "$SUMMARY" | head -20
fi
