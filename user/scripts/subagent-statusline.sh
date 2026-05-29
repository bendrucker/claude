#!/bin/bash
input=$(cat)

yellow=$'\033[33m'
green=$'\033[32m'
red=$'\033[31m'
dim=$'\033[2m'
reset=$'\033[0m'

# Origin glyphs: desktop for local agents, cloud for remote agents.
# Generated via python3 because macOS bash 3.2 lacks \u escapes.
read -r local_glyph remote_glyph < <(python3 -c "print(chr(0xF108), chr(0xF0C2))")

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

# Reads status_icon, origin_glyph, text, and meta from the calling render_task
# scope (bash dynamic scoping).
build_content() {
  local body="${status_icon} ${origin_glyph} ${text}"
  if [ -n "$meta" ]; then
    body+=" ${dim}${meta}${reset}"
  fi
  printf '%s' "$body"
}

render_task() {
  local task=$1
  local columns=$2
  local id description type name status start_time token_count status_icon origin_glyph text meta content
  id=$(echo "$task" | jq -r '.id')
  description=$(echo "$task" | jq -r '.description // empty')
  type=$(echo "$task" | jq -r '.type // empty')
  name=$(echo "$task" | jq -r '.name // empty')
  status=$(echo "$task" | jq -r '.status // "running"')
  start_time=$(echo "$task" | jq -r '.startTime // empty')
  token_count=$(echo "$task" | jq -r '.tokenCount // 0')

  case "$status" in
    completed) status_icon="${green}✓${reset}" ;;
    failed)    status_icon="${red}✗${reset}" ;;
    *)         status_icon="${yellow}▶${reset}" ;;
  esac

  # .type is the agent origin (local_agent or remote_agent), not the agent kind.
  case "$type" in
    remote_agent) origin_glyph="${dim}${remote_glyph}${reset}" ;;
    *)            origin_glyph="${dim}${local_glyph}${reset}" ;;
  esac

  text="${description:-${name:-agent}}"

  meta=""
  if [ -n "$start_time" ]; then
    meta+="· $(format_elapsed "$start_time") "
  fi
  if [ "$token_count" -gt 0 ]; then
    meta+="· $(format_tokens "$token_count")"
  fi

  content=$(build_content)

  if [ -n "$columns" ]; then
    local visible
    visible=$(printf '%s' "$content" | sed $'s/\033\\[[0-9;]*m//g')
    if [ "${#visible}" -gt "$columns" ]; then
      local overflow=$(( ${#visible} - columns ))
      local text_max=$(( ${#text} - overflow - 1 ))
      if [ "$text_max" -gt 0 ]; then
        text="${text:0:$text_max}…"
        content=$(build_content)
      fi
    fi
  fi

  jq -c --null-input --arg id "$id" --rawfile content <(printf '%s' "$content") '{id: $id, content: $content}'
}

columns=$(echo "$input" | jq -r '.columns // empty')

echo "$input" | jq -c '.tasks[]' | while IFS= read -r task; do
  render_task "$task" "$columns"
done
