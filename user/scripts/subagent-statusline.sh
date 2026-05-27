#!/bin/bash
input=$(cat)

yellow=$'\033[33m'
green=$'\033[32m'
red=$'\033[31m'
dim=$'\033[2m'
reset=$'\033[0m'

format_elapsed() {
  local start_ms=$1 now_ms elapsed_s mins secs
  now_ms=$(date +%s)000
  elapsed_s=$(( (now_ms - start_ms) / 1000 ))
  mins=$(( elapsed_s / 60 ))
  secs=$(( elapsed_s % 60 ))
  printf "%dm %ds" "$mins" "$secs"
}

format_tokens() {
  local count=$1
  if [ "$count" -ge 1000 ]; then
    printf "%.1fk" "$(echo "$count / 1000" | bc -l)"
  else
    printf "%d" "$count"
  fi
}

render_task() {
  local task=$1
  local id name status start_time token_count icon meta content
  id=$(echo "$task" | jq -r '.id')
  name=$(echo "$task" | jq -r '.name // "agent"')
  status=$(echo "$task" | jq -r '.status // "running"')
  start_time=$(echo "$task" | jq -r '.startTime // empty')
  token_count=$(echo "$task" | jq -r '.tokenCount // 0')

  case "$status" in
    completed) icon="${green}✓${reset}" ;;
    failed)    icon="${red}✗${reset}" ;;
    *)         icon="${yellow}▸${reset}" ;;
  esac

  meta=""
  if [ -n "$start_time" ]; then
    meta+="· $(format_elapsed "$start_time") "
  fi
  if [ "$token_count" -gt 0 ]; then
    meta+="· $(format_tokens "$token_count")"
  fi

  content="${icon} ${name}"
  if [ -n "$meta" ]; then
    content+=" ${dim}${meta}${reset}"
  fi

  jq -c --null-input --arg id "$id" --rawfile content <(printf '%s' "$content") '{id: $id, content: $content}'
}

echo "$input" | jq -c '.tasks[]' | while IFS= read -r task; do
  render_task "$task"
done
