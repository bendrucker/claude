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
  local columns=$2
  local id description type name status start_time token_count icon meta label content
  id=$(echo "$task" | jq -r '.id')
  description=$(echo "$task" | jq -r '.description // empty')
  type=$(echo "$task" | jq -r '.type // empty')
  name=$(echo "$task" | jq -r '.name // empty')
  status=$(echo "$task" | jq -r '.status // "running"')
  start_time=$(echo "$task" | jq -r '.startTime // empty')
  token_count=$(echo "$task" | jq -r '.tokenCount // 0')

  case "$status" in
    completed) icon="${green}✓${reset}" ;;
    failed)    icon="${red}✗${reset}" ;;
    *)         icon="${yellow}▸${reset}" ;;
  esac

  if [ -n "$description" ] && [ -n "$type" ]; then
    label="${dim}${type}${reset}  ${description}"
  elif [ -n "$description" ]; then
    label="$description"
  elif [ -n "$type" ]; then
    label="$type"
  elif [ -n "$name" ]; then
    label="$name"
  else
    label="agent"
  fi

  meta=""
  if [ -n "$start_time" ]; then
    meta+="· $(format_elapsed "$start_time") "
  fi
  if [ "$token_count" -gt 0 ]; then
    meta+="· $(format_tokens "$token_count")"
  fi

  content="${icon} ${label}"
  if [ -n "$meta" ]; then
    content+=" ${dim}${meta}${reset}"
  fi

  if [ -n "$columns" ]; then
    local visible
    visible=$(printf '%s' "$content" | sed $'s/\033\\[[0-9;]*m//g')
    if [ "${#visible}" -gt "$columns" ]; then
      local overflow=$(( ${#visible} - columns ))
      local desc_max=$(( ${#description} - overflow - 1 ))
      if [ "$desc_max" -gt 0 ]; then
        description="${description:0:$desc_max}…"
        if [ -n "$type" ]; then
          label="${dim}${type}${reset}  ${description}"
        else
          label="$description"
        fi
        content="${icon} ${label}"
        if [ -n "$meta" ]; then
          content+=" ${dim}${meta}${reset}"
        fi
      fi
    fi
  fi

  jq -c --null-input --arg id "$id" --rawfile content <(printf '%s' "$content") '{id: $id, content: $content}'
}

columns=$(echo "$input" | jq -r '.columns // empty')

echo "$input" | jq -c '.tasks[]' | while IFS= read -r task; do
  render_task "$task" "$columns"
done
